import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { DB_VERSION, FeedStore, type EmbeddingRecord } from "../../src/background/db";
import { DAY_MS } from "../../src/shared/metrics";

const NOW = Date.parse("2026-11-05T12:00:00Z");

/**
 * Exactly the schema shipped in v0.1/v0.2 (DB version 1). Kept frozen here so the upgrade
 * path is tested against a real version-1 database, not against today's code.
 */
function openV1(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ex = db.createObjectStore("exposures", { keyPath: "key" });
      ex.createIndex("ts", "ts");
      db.createObjectStore("meta", { keyPath: "k" });
      const cache = db.createObjectStore("cache", { keyPath: "key" });
      cache.createIndex("article", "article");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(db: IDBDatabase, store: string, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    for (const r of rows) t.objectStore(store).put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

const v1Rows = [
  // v0.1 row: no language, excerpt only
  { key: "s1:1", sessionId: "s1", statusId: "1", author: "alice", ts: NOW - DAY_MS, topics: ["chatgpt"], excerpt: "ChatGPT wrote my tests", catalogVersion: "2026.11.1" },
  // v0.2 row: language, excerpt only
  { key: "s1:2", sessionId: "s1", statusId: "2", author: "kenji", ts: NOW - 2 * DAY_MS, topics: [], excerpt: "上海房租又涨了", catalogVersion: "2026.11.2", lang: "zh" },
];

describe("schema migration v1 → v2", () => {
  it("keeps every v1 row, meta and cache entry and adds the embedding store", async () => {
    const factory = new IDBFactory();
    const v1 = await openV1(factory, "m");
    await put(v1, "exposures", v1Rows);
    await put(v1, "meta", [
      { k: "epoch", v: 3 },
      { k: "recording", v: true },
      { k: "trackingSince", v: NOW - 20 * DAY_MS },
      { k: "pauses", v: [] },
    ]);
    await put(v1, "cache", [{ key: "ChatGPT|a|b", article: "ChatGPT", start: "a", end: "b", trend: {}, fetchedAt: NOW - DAY_MS }]);
    v1.close();

    const store = new FeedStore(factory, "m");
    const db = await store.open();
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(["cache", "embeddings", "exposures", "meta"]);
    const rows = await store.exposuresSince(0, NOW);
    expect(rows.map((r) => r.statusId).sort()).toEqual(["1", "2"]);
    // Untouched: no text backfill, no language invented, no catalog labels rewritten.
    expect(rows.find((r) => r.statusId === "1")).toEqual(v1Rows[0]);
    expect(rows.find((r) => r.statusId === "2")).toEqual(v1Rows[1]);
    const meta = await store.getMeta();
    expect(meta).toMatchObject({ epoch: 3, recording: true });
    expect(await store.latestCacheForArticle("ChatGPT")).toBeTruthy();
    expect(await store.countEmbeddings()).toBe(0);

    // Dedupe still works against migrated rows; new rows carry analysis text.
    expect(await store.recordExposure({ ...v1Rows[0]!, key: undefined } as never, 3, NOW)).toBe("duplicate");
    expect(
      await store.recordExposure(
        { sessionId: "s2", statusId: "3", author: "bob", ts: NOW, topics: [], excerpt: "x", catalogVersion: "c", lang: "en", text: "full text", textVersion: 1 },
        3,
        NOW,
      ),
    ).toBe("recorded");
  });

  it("opening an already-migrated database again is a no-op", async () => {
    const factory = new IDBFactory();
    const a = new FeedStore(factory, "m2");
    await a.putEmbeddings([emb("k1")], 0);
    (await a.open()).close();
    const b = new FeedStore(factory, "m2");
    expect(await b.countEmbeddings()).toBe(1);
  });
});

function emb(key: string): EmbeddingRecord {
  return { key, vec: new Float32Array([1, 0, 0]), tokens: 3, chunks: 1, truncated: false, createdAt: NOW };
}

describe("embedding cache", () => {
  it("rejects writes from before a delete (epoch checked in the same transaction)", async () => {
    const store = new FeedStore(new IDBFactory(), "e1");
    await store.setRecording(true, NOW);
    expect(await store.putEmbeddings([emb("a")], 0)).toBe(true);
    const epoch = await store.clearAll(NOW);
    expect(epoch).toBe(1);
    expect(await store.countEmbeddings()).toBe(0); // delete removes vectors with history
    expect(await store.putEmbeddings([emb("b")], 0)).toBe(false); // stale in-flight result
    expect(await store.countEmbeddings()).toBe(0);
    expect(await store.putEmbeddings([emb("c")], 1)).toBe(true);
  });

  it("round-trips Float32Array vectors and sweeps orphans", async () => {
    const store = new FeedStore(new IDBFactory(), "e2");
    await store.putEmbeddings([emb("keep"), emb("orphan")], 0);
    const got = await store.getEmbeddings(["keep", "missing"]);
    expect([...got.keys()]).toEqual(["keep"]);
    expect(got.get("keep")!.vec).toBeInstanceOf(Float32Array);
    expect([...got.get("keep")!.vec]).toEqual([1, 0, 0]);
    expect(await store.sweepEmbeddings(new Set(["keep"]))).toBe(1);
    expect(await store.countEmbeddings()).toBe(1);
  });
});
