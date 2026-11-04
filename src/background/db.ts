import { DAY_MS, RETENTION_DAYS, type PauseInterval } from "../shared/metrics";
import type { WikiTrend } from "../shared/wiki";

/**
 * IndexedDB persistence for the service worker.
 *
 * - `exposures`: one row per (session, status ID). The key itself is the dedupe
 *   constraint, so repeated messages, overlapping writes and service-worker
 *   restarts can never double-count.
 * - `meta`: epoch (incremented by Delete data), recording flag, trackingSince, pauses.
 *   Every write that could resurrect deleted data checks the epoch inside the
 *   same transaction, so a write queued before a delete is rejected after it.
 * - `cache`: Wikimedia responses by article + date range.
 */

export const DB_NAME = "x-feed-lens";
export const DB_VERSION = 1;

export interface ExposureRecord {
  /** `${sessionId}:${statusId}` */
  key: string;
  sessionId: string;
  statusId: string;
  author: string | null;
  ts: number;
  topics: string[];
  excerpt: string;
  catalogVersion: string;
}

export interface CacheRecord {
  /** `${article}|${start}|${end}` */
  key: string;
  article: string;
  start: string;
  end: string;
  trend: WikiTrend;
  fetchedAt: number;
}

export interface Meta {
  epoch: number;
  recording: boolean;
  trackingSince: number | null;
  pauses: PauseInterval[];
}

const DEFAULT_META: Meta = { epoch: 0, recording: false, trackingSince: null, pauses: [] };

export type RecordOutcome = "recorded" | "duplicate" | "stale-epoch" | "paused";

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("Transaction aborted"));
  });
}

function readMeta(store: IDBObjectStore, cb: (m: Meta) => void): void {
  const r = store.getAll();
  r.onsuccess = () => {
    const m: Meta = { ...DEFAULT_META, pauses: [] };
    for (const row of r.result as { k: keyof Meta; v: never }[]) {
      (m as unknown as Record<string, unknown>)[row.k] = row.v;
    }
    cb(m);
  };
}

function writeMeta(store: IDBObjectStore, patch: Partial<Meta>): void {
  for (const [k, v] of Object.entries(patch)) store.put({ k, v });
}

export function retentionCutoff(now: number): number {
  return now - RETENTION_DAYS * DAY_MS;
}

export class FeedStore {
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly name = DB_NAME,
  ) {}

  open(): Promise<IDBDatabase> {
    if (this.dbp) return this.dbp;
    this.dbp = new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const ex = db.createObjectStore("exposures", { keyPath: "key" });
        ex.createIndex("ts", "ts");
        db.createObjectStore("meta", { keyPath: "k" });
        const cache = db.createObjectStore("cache", { keyPath: "key" });
        cache.createIndex("article", "article");
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbp = null;
        };
        db.onclose = () => {
          this.dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        this.dbp = null;
        reject(req.error);
      };
    });
    return this.dbp;
  }

  async getMeta(): Promise<Meta> {
    const db = await this.open();
    const t = db.transaction("meta", "readonly");
    let meta: Meta = DEFAULT_META;
    readMeta(t.objectStore("meta"), (m) => (meta = m));
    await txDone(t);
    return meta;
  }

  /** Turns recording on/off, tracking pause intervals. Returns the new meta. */
  async setRecording(on: boolean, now: number): Promise<Meta> {
    const db = await this.open();
    const t = db.transaction("meta", "readwrite");
    const store = t.objectStore("meta");
    let out: Meta = DEFAULT_META;
    readMeta(store, (m) => {
      const next: Meta = { ...m, pauses: [...m.pauses], recording: on };
      if (on) {
        if (m.trackingSince === null) next.trackingSince = now;
        const open = next.pauses.find((p) => p.to === null);
        if (open) open.to = now;
      } else if (m.recording && m.trackingSince !== null) {
        next.pauses.push({ from: now, to: null });
      }
      const cutoff = retentionCutoff(now);
      next.pauses = next.pauses.filter((p) => p.to === null || p.to > cutoff);
      writeMeta(store, next);
      out = next;
    });
    await txDone(t);
    return out;
  }

  /**
   * Persists a qualified exposure. Dedupe key is session + status ID.
   * Rejected when recording is off or the caller's epoch predates a delete.
   */
  async recordExposure(rec: Omit<ExposureRecord, "key">, epoch: number, now: number): Promise<RecordOutcome> {
    const db = await this.open();
    const t = db.transaction(["exposures", "meta"], "readwrite");
    const ex = t.objectStore("exposures");
    let outcome: RecordOutcome = "duplicate";
    const key = `${rec.sessionId}:${rec.statusId}`;
    readMeta(t.objectStore("meta"), (meta) => {
      if (meta.epoch !== epoch) {
        outcome = "stale-epoch";
        return;
      }
      if (!meta.recording) {
        outcome = "paused";
        return;
      }
      const g = ex.count(key);
      g.onsuccess = () => {
        if (g.result > 0) {
          outcome = "duplicate";
          return;
        }
        ex.add({ ...rec, key });
        outcome = "recorded";
        // Retention: drop anything older than 30 days in the same transaction.
        const old = ex.index("ts").openCursor(IDBKeyRange.upperBound(retentionCutoff(now), true));
        old.onsuccess = () => {
          const c = old.result;
          if (c) {
            c.delete();
            c.continue();
          }
        };
      };
    });
    await txDone(t);
    return outcome;
  }

  /** Exposures with ts >= since, after pruning anything past retention. */
  async exposuresSince(since: number, now: number): Promise<ExposureRecord[]> {
    await this.prune(now);
    const db = await this.open();
    const t = db.transaction("exposures", "readonly");
    const rows = await reqDone(t.objectStore("exposures").index("ts").getAll(IDBKeyRange.lowerBound(since)));
    return rows as ExposureRecord[];
  }

  async countExposures(): Promise<{ count: number; oldest: number | null }> {
    const db = await this.open();
    const t = db.transaction("exposures", "readonly");
    const store = t.objectStore("exposures");
    const count = await reqDone(store.count());
    const first = await reqDone(store.index("ts").openCursor());
    return { count, oldest: first ? (first.value as ExposureRecord).ts : null };
  }

  async prune(now: number): Promise<void> {
    const db = await this.open();
    const t = db.transaction(["exposures", "cache"], "readwrite");
    const cutoff = retentionCutoff(now);
    const cur = t.objectStore("exposures").index("ts").openCursor(IDBKeyRange.upperBound(cutoff, true));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        c.delete();
        c.continue();
      }
    };
    const cc = t.objectStore("cache").openCursor();
    cc.onsuccess = () => {
      const c = cc.result;
      if (c) {
        if ((c.value as CacheRecord).fetchedAt < cutoff) c.delete();
        c.continue();
      }
    };
    await txDone(t);
  }

  /** Deletes history, excerpts and caches; bumps the epoch. Returns the new epoch. */
  async clearAll(now: number): Promise<number> {
    const db = await this.open();
    const t = db.transaction(["exposures", "cache", "meta"], "readwrite");
    t.objectStore("exposures").clear();
    t.objectStore("cache").clear();
    const meta = t.objectStore("meta");
    let epoch = 0;
    readMeta(meta, (m) => {
      epoch = m.epoch + 1;
      writeMeta(meta, { epoch, pauses: [], trackingSince: m.recording ? now : null });
    });
    await txDone(t);
    return epoch;
  }

  async getCache(key: string): Promise<CacheRecord | undefined> {
    const db = await this.open();
    const t = db.transaction("cache", "readonly");
    return (await reqDone(t.objectStore("cache").get(key))) as CacheRecord | undefined;
  }

  async latestCacheForArticle(article: string): Promise<CacheRecord | undefined> {
    const db = await this.open();
    const t = db.transaction("cache", "readonly");
    const all = (await reqDone(t.objectStore("cache").index("article").getAll(article))) as CacheRecord[];
    return all.sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
  }

  /** Caches a successful lookup unless data was deleted since the request started. */
  async putCache(rec: CacheRecord, epoch: number): Promise<boolean> {
    const db = await this.open();
    const t = db.transaction(["cache", "meta"], "readwrite");
    const cache = t.objectStore("cache");
    let stored = false;
    readMeta(t.objectStore("meta"), (m) => {
      if (m.epoch !== epoch) return;
      cache.put(rec);
      stored = true;
    });
    await txDone(t);
    return stored;
  }
}
