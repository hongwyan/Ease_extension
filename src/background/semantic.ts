/**
 * Query-relative semantic analysis, coordinated by the service worker.
 *
 * Flow for one click (one requestId):
 *   1. Load the two comparison periods of history and the true 30-day count.
 *   2. Derive each row's analysis input (stored text, or the legacy excerpt), skip rows without
 *      usable text (unassessable), and key every input by encoder identity + SHA-256 of the text.
 *   3. Use cached vectors first; encode only missing texts, in small batches, through the
 *      offscreen inference worker. Identical texts are encoded once, also across concurrent
 *      requests. Every batch re-checks cancellation and the deletion epoch; vectors are stored
 *      only inside an epoch-checked transaction.
 *   4. Compare the clicked post with ALL assessable rows in both periods (not top-K), then build
 *      the counts with computeSemanticMetrics.
 * State lives in memory only; after a service-worker restart the next poll recreates the job
 * and resumes from the durable embedding cache. Nothing here records an exposure.
 */
import type { ExposureRecord, EmbeddingRecord, FeedStore } from "./db";
import type { EvidenceItem, SemanticErrorKind, SemanticRequest, SemanticResult, SemanticState } from "../shared/messages";
import { comparisonPeriods, langOf } from "../shared/metrics";
import { computeSemanticMetrics, pickEvidence, type AssessedRow } from "../shared/semanticMetrics";
import { isAssessable, preprocess, sha256Hex, cosine } from "../semantic/core";
import { RELATED_THRESHOLDS, RELEASE_ENCODER, THRESHOLD_VERSION, encoderKey, isRelated } from "../semantic/model";

export interface EncodedText {
  vec: Float32Array;
  tokens: number;
  chunks: number;
  truncated: boolean;
}

export interface EncoderClient {
  embed(texts: string[], timeoutMs: number): Promise<{ results: EncodedText[]; cold: boolean }>;
}

export class EncoderFailure extends Error {
  constructor(
    readonly kind: Extract<SemanticErrorKind, "model-unavailable" | "inference" | "timeout">,
    message: string,
  ) {
    super(message);
  }
}

/** Texts per encoder call: small enough for steady progress and quick cancellation. */
export const BATCH = 16;
/** First call may include model initialization. */
export const COLD_TIMEOUT_MS = 120_000;
export const WARM_TIMEOUT_MS = 60_000;
/** A job nobody has polled for this long is abandoned (tab closed, panel gone). */
export const LEASE_MS = 20_000;
/** Finished jobs are kept briefly so a late poll still gets the result. */
const KEEP_DONE_MS = 60_000;
const SWEEP_EVERY_MS = 10 * 60_000;
const LICENSE = "Apache-2.0";

/** Analysis input for a stored exposure: v0.3+ text, else the pre-v0.3 excerpt (without its ellipsis). */
export function rowInput(r: Pick<ExposureRecord, "text" | "excerpt">): { input: string; fromExcerpt: boolean } {
  if (typeof r.text === "string" && r.text.trim()) return { input: preprocess(r.text), fromExcerpt: false };
  return { input: preprocess((r.excerpt ?? "").replace(/…$/u, "")), fromExcerpt: true };
}

export async function embeddingKey(input: string): Promise<string> {
  return `${await encoderPrefix()}:${await sha256Hex(input)}`;
}

let prefixP: Promise<string> | null = null;
function encoderPrefix(): Promise<string> {
  prefixP ??= sha256Hex(encoderKey()).then((h) => h.slice(0, 16));
  return prefixP;
}

interface Job {
  req: SemanticRequest;
  state: SemanticState;
  cancelled: false | "drop" | "partial";
  lastPoll: number;
  finishedAt: number | null;
}

export interface SemanticServiceDeps {
  store: FeedStore;
  encoder: EncoderClient;
  now: () => number;
}

export class SemanticService {
  private jobs = new Map<string, Job>();
  /** Encodes in flight, shared by concurrent jobs (two tabs, repeated clicks). */
  private inflight = new Map<string, Promise<EmbeddingRecord | null>>();
  /** Vectors of clicked posts that are not recorded exposures: memory only, never persisted. */
  private queryCache = new Map<string, EmbeddingRecord>();
  private epoch: number | null = null;
  private lastSweep = 0;
  private warm = false;

  constructor(private readonly deps: SemanticServiceDeps) {}

  /** Starts the job for a new requestId, or returns the current state of an existing one. */
  request(req: SemanticRequest): SemanticState {
    this.gc();
    const existing = this.jobs.get(req.requestId);
    if (existing) {
      existing.lastPoll = this.deps.now();
      return existing.state;
    }
    const job: Job = {
      req,
      state: { phase: "working", stage: "indexing", done: 0, total: 0 },
      cancelled: false,
      lastPoll: this.deps.now(),
      finishedAt: null,
    };
    this.jobs.set(req.requestId, job);
    void this.run(job);
    return job.state;
  }

  cancel(requestId: string, keepPartial: boolean): SemanticState | null {
    const job = this.jobs.get(requestId);
    if (!job) return null;
    if (job.state.phase === "working") job.cancelled = keepPartial ? "partial" : "drop";
    if (!keepPartial) this.jobs.delete(requestId);
    return job.state;
  }

  /** Delete data: every running job is discarded and in-memory vectors are dropped. */
  reset(newEpoch: number): void {
    this.epoch = newEpoch;
    for (const job of this.jobs.values()) {
      job.cancelled = "drop";
      job.state = { phase: "error", kind: "deleted", message: "Local data was deleted while the analysis was running." };
    }
    this.jobs.clear();
    this.queryCache.clear();
    this.inflight.clear();
  }

  activeJobs(): number {
    return [...this.jobs.values()].filter((j) => j.state.phase === "working").length;
  }

  private gc(): void {
    const now = this.deps.now();
    for (const [id, j] of this.jobs) {
      if (j.state.phase === "working" && now - j.lastPoll > LEASE_MS) j.cancelled = "drop";
      if (j.finishedAt !== null && now - j.finishedAt > KEEP_DONE_MS) this.jobs.delete(id);
      if (j.cancelled === "drop" && j.state.phase !== "working") this.jobs.delete(id);
    }
  }

  private finish(job: Job, state: SemanticState): void {
    job.state = state;
    job.finishedAt = this.deps.now();
  }

  private async run(job: Job): Promise<void> {
    const t0 = this.deps.now();
    const { req } = job;
    const { store } = this.deps;
    try {
      const meta = await store.getMeta();
      this.epoch ??= meta.epoch;
      if (meta.epoch !== req.epoch || this.epoch !== meta.epoch) {
        return this.finish(job, { phase: "error", kind: "deleted", message: "Local data changed; reopen the panel." });
      }
      const epoch = meta.epoch;
      const now = this.deps.now();
      const { previous } = comparisonPeriods(now);
      const [rows, counts] = await Promise.all([store.exposuresSince(previous.start, now), store.countExposures()]);

      const query = preprocess(req.text);
      const recordedQuery = rows.find((r) => r.statusId === req.statusId);
      const base = {
        retainedTotal: counts.count,
        model: { id: RELEASE_ENCODER.modelId, revision: RELEASE_ENCODER.revision, license: LICENSE, threshold: RELATED_THRESHOLDS.sameLanguage, thresholdVersion: THRESHOLD_VERSION },
      };
      const others = rows.filter((r) => r.statusId !== req.statusId);
      if (!isAssessable(query)) {
        return this.finish(job, {
          phase: "done",
          result: this.emptyResult("insufficient-text", base, !!recordedQuery, now, t0, meta, rows, req),
        });
      }

      // Analysis inputs and cache keys for every other row in the two periods.
      const items = await Promise.all(
        rows.map(async (r) => {
          const { input, fromExcerpt } = rowInput(r);
          const assessable = r.statusId !== req.statusId && isAssessable(input);
          return { r, input, fromExcerpt, assessable, key: assessable ? await embeddingKey(input) : null };
        }),
      );
      const queryKey = await embeddingKey(query);
      const needed = new Map<string, string>([[queryKey, query]]);
      for (const it of items) if (it.key) needed.set(it.key, it.input);

      const vectors = await store.getEmbeddings([...needed.keys()]);
      const qc = this.queryCache.get(queryKey);
      if (qc && !vectors.has(queryKey)) vectors.set(queryKey, qc);
      const cachedCount = vectors.size;
      // The clicked post first, then history newest first.
      const missing = [...needed.keys()].filter((k) => !vectors.has(k));
      const persistQuery = !!recordedQuery || items.some((it) => it.key === queryKey);

      let encodeMs = 0;
      let encoded = 0;
      let cold = false;
      job.state = { phase: "working", stage: this.warm ? "indexing" : "loading-model", done: 0, total: missing.length };
      const deleted = () => this.finish(job, { phase: "error", kind: "deleted", message: "Local data was deleted while the analysis was running." });
      // Pass 1 may wait on encodes another request already started; pass 2 encodes whatever those left missing.
      for (const share of [true, false]) {
        const todo = missing.filter((k) => !vectors.has(k));
        for (let i = 0; i < todo.length; i += BATCH) {
          if (job.cancelled) break;
          if (this.epoch !== epoch) return deleted();
          const batch = todo.slice(i, i + BATCH);
          const theirs = share ? batch.flatMap((k) => (this.inflight.has(k) ? [[k, this.inflight.get(k)!] as const] : [])) : [];
          const mine = batch.filter((k) => !theirs.some(([t]) => t === k));
          if (mine.length > 0) {
            const t1 = this.deps.now();
            const work = this.encodeBatch(mine, needed, epoch, mine.filter((k) => k !== queryKey || persistQuery));
            mine.forEach((k, j) => this.inflight.set(k, work.then((r) => r[j] ?? null, () => null)));
            let recs: (EmbeddingRecord | null)[];
            try {
              recs = await work;
            } finally {
              for (const k of mine) this.inflight.delete(k);
            }
            encodeMs += this.deps.now() - t1;
            encoded += mine.length;
            mine.forEach((k, j) => recs[j] && vectors.set(k, recs[j]!));
            const qi = mine.indexOf(queryKey);
            if (!persistQuery && qi >= 0 && recs[qi]) this.rememberQuery(queryKey, recs[qi]!);
            cold ||= this.lastCold;
          }
          for (const [k, p] of theirs) {
            const r = await p;
            if (r) vectors.set(k, r);
          }
          const done = missing.filter((k) => vectors.has(k)).length;
          job.state = { phase: "working", stage: "indexing", done, total: missing.length };
        }
      }
      if (job.cancelled === "drop") return this.finish(job, { phase: "cancelled" });
      if (this.epoch !== epoch) return this.finish(job, { phase: "error", kind: "deleted", message: "Local data was deleted while the analysis was running." });

      const q = vectors.get(queryKey);
      if (!q) {
        // Cancelled before the clicked post itself was encoded: nothing can be compared.
        return this.finish(job, { phase: "cancelled" });
      }
      job.state = { phase: "working", stage: "scoring", done: missing.length, total: missing.length };
      const assessed: (AssessedRow & { excerpt: string })[] = items.map((it) => {
        const base = { ts: it.r.ts, statusId: it.r.statusId, author: it.r.author, topics: it.r.topics, excerpt: it.r.excerpt, lang: langOf(it.r), fromExcerpt: it.fromExcerpt };
        if (!it.key) return { ...base, relatedness: "unassessable", score: null };
        const v = vectors.get(it.key);
        if (!v) return { ...base, relatedness: "pending", score: null };
        const score = cosine(q.vec, v.vec);
        return { ...base, relatedness: isRelated(score, req.lang, langOf(it.r)) ? "related" : "unrelated", score };
      });
      const metrics = computeSemanticMetrics(assessed, req.statusId, req.lang, now, meta.trackingSince, meta.pauses);
      const evidence: EvidenceItem[] = pickEvidence(assessed, req.statusId).map((r) => ({
        statusId: r.statusId,
        author: r.author,
        ts: r.ts,
        lang: langOf(r),
        excerpt: r.excerpt,
        score: Math.round((r.score ?? 0) * 1000) / 1000,
        fromExcerpt: r.fromExcerpt,
      }));
      const pending = assessed.some((r) => r.relatedness === "pending");
      const result: SemanticResult = {
        outcome: others.length === 0 ? "empty-history" : "ok",
        partial: pending,
        metrics,
        evidence,
        query: { recorded: !!recordedQuery, tokens: q.tokens, chunks: q.chunks, truncated: q.truncated },
        ...base,
        timings: { totalMs: this.deps.now() - t0, encodeMs, encoded, cached: cachedCount, cold },
      };
      this.finish(job, { phase: "done", result });
      if (!pending) void this.maybeSweep(now).catch(() => undefined);
    } catch (e) {
      if (e instanceof EncoderFailure) this.finish(job, { phase: "error", kind: e.kind, message: e.message });
      else this.finish(job, { phase: "error", kind: "storage", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private lastCold = false;

  private async encodeBatch(keys: string[], inputs: Map<string, string>, epoch: number, persist: string[]): Promise<(EmbeddingRecord | null)[]> {
    const { results, cold } = await this.deps.encoder.embed(
      keys.map((k) => inputs.get(k)!),
      this.warm ? WARM_TIMEOUT_MS : COLD_TIMEOUT_MS,
    );
    this.warm = true;
    this.lastCold = cold;
    if (results.length !== keys.length) throw new EncoderFailure("inference", "The encoder returned an unexpected number of vectors.");
    const now = this.deps.now();
    const recs = keys.map((key, i) => ({ key, ...results[i]!, createdAt: now }));
    // Stale results (data deleted meanwhile) are discarded by the epoch check inside the transaction.
    const stored = await this.deps.store.putEmbeddings(recs.filter((r) => persist.includes(r.key)), epoch);
    if (!stored || this.epoch !== epoch) return keys.map(() => null);
    return recs;
  }

  private rememberQuery(key: string, rec: EmbeddingRecord): void {
    this.queryCache.delete(key);
    this.queryCache.set(key, rec);
    while (this.queryCache.size > 32) this.queryCache.delete(this.queryCache.keys().next().value!);
  }

  /** Drops embeddings no retained exposure references (aged-out history, other encoders). Throttled. */
  private async maybeSweep(now: number): Promise<void> {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    const rows = await this.deps.store.allExposures(now);
    const keep = new Set<string>();
    for (const r of rows) {
      const { input } = rowInput(r);
      if (isAssessable(input)) keep.add(await embeddingKey(input));
    }
    await this.deps.store.sweepEmbeddings(keep);
  }

  private emptyResult(
    outcome: SemanticResult["outcome"],
    base: Pick<SemanticResult, "retainedTotal" | "model">,
    recorded: boolean,
    now: number,
    t0: number,
    meta: { trackingSince: number | null; pauses: { from: number; to: number | null }[] },
    rows: ExposureRecord[],
    req: SemanticRequest,
  ): SemanticResult {
    const assessed: AssessedRow[] = rows.map((r) => ({ ...r, lang: langOf(r), relatedness: "pending", score: null, fromExcerpt: !r.text }));
    return {
      outcome,
      partial: false,
      metrics: computeSemanticMetrics(assessed, req.statusId, req.lang, now, meta.trackingSince, meta.pauses),
      evidence: [],
      query: { recorded, tokens: 0, chunks: 0, truncated: false },
      ...base,
      timings: { totalMs: this.deps.now() - t0, encodeMs: 0, encoded: 0, cached: 0, cold: false },
    };
  }
}
