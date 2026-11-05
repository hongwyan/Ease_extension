/**
 * Coordination, caching, cancellation and deletion of the semantic service, with a
 * deterministic encoder double (keyword → basis vector). Real model quality is covered by
 * the packaged-extension gate (tests/semantic) and the browser tests.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { FeedStore, type ExposureRecord } from "../../src/background/db";
import { EncoderFailure, SemanticService, embeddingKey, type EncoderClient } from "../../src/background/semantic";
import type { SemanticRequest, SemanticResult, SemanticState } from "../../src/shared/messages";
import { DAY_MS } from "../../src/shared/metrics";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

class FakeEncoder implements EncoderClient {
  calls: string[][] = [];
  gate: Promise<void> | null = null;
  fail: EncoderFailure | null = null;
  async embed(texts: string[]) {
    this.calls.push(texts);
    if (this.gate) await this.gate;
    if (this.fail) throw this.fail;
    return {
      cold: this.calls.length === 1,
      results: texts.map((t) => {
        const v = new Float32Array(4);
        if (/rent|房租/i.test(t)) v[0] = 1;
        else if (/cat|猫/i.test(t)) v[1] = 1;
        else v[2] = 1;
        return { vec: v, tokens: t.length, chunks: 1, truncated: false };
      }),
    };
  }
  get texts(): number {
    return this.calls.reduce((s, c) => s + c.length, 0);
  }
}

let store: FeedStore;
let enc: FakeEncoder;
let svc: SemanticService;
let seq = 0;

function rec(statusId: string, text: string | null, opts: Partial<ExposureRecord> = {}): Omit<ExposureRecord, "key"> {
  return {
    sessionId: S1,
    statusId,
    author: `u${statusId}`,
    ts: NOW - DAY_MS,
    topics: [],
    excerpt: (text ?? "").slice(0, 140),
    catalogVersion: "t",
    lang: "en",
    ...(text !== null ? { text, textVersion: 1 } : {}),
    ...opts,
  };
}

function req(statusId: string, text: string, lang = "en", epoch = 0): SemanticRequest {
  seq++;
  return { type: "semantic", requestId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, statusId, text, lang, epoch };
}

async function settle(r: SemanticRequest): Promise<SemanticState> {
  for (let i = 0; i < 500; i++) {
    const st = svc.request(r);
    if (st.phase !== "working") return st;
    await new Promise((res) => setTimeout(res, 1));
  }
  throw new Error("job did not finish");
}

async function result(r: SemanticRequest): Promise<SemanticResult> {
  const st = await settle(r);
  if (st.phase !== "done") throw new Error(`expected done, got ${JSON.stringify(st)}`);
  return st.result;
}

beforeEach(async () => {
  store = new FeedStore(new IDBFactory(), "svc");
  await store.setRecording(true, NOW - 20 * DAY_MS);
  enc = new FakeEncoder();
  svc = new SemanticService({ store, encoder: enc, now: () => NOW });
});

describe("SemanticService", () => {
  it("compares the clicked post with every other row; identical text is encoded once but counted per exposure", async () => {
    await store.recordExposure(rec("1", "Rent in Shanghai went up again"), 0, NOW);
    await store.recordExposure(rec("1", "Rent in Shanghai went up again", { sessionId: S2 }), 0, NOW); // same post, 2nd session
    await store.recordExposure(rec("2", "上海房租又涨了", { lang: "zh" }), 0, NOW);
    await store.recordExposure(rec("3", "My cat knocked my coffee over"), 0, NOW);
    await store.recordExposure(rec("4", "My cat knocked my coffee over", { sessionId: S2 }), 0, NOW); // other post, identical text
    const r = await result(req("9", "Landlord raised my rent again"));
    expect(r.outcome).toBe("ok");
    expect(r.query.recorded).toBe(false);
    expect(r.metrics!.all.current).toMatchObject({ eligible: 5, assessed: 5, related: 3 });
    // 3 distinct row texts + the query, each encoded exactly once.
    expect(enc.texts).toBe(4);
    expect(r.evidence.map((e) => e.statusId).sort()).toEqual(["1", "2"]);
    // The clicked post's vector is not persisted when the post is not recorded.
    expect(await store.countEmbeddings()).toBe(3);
  });

  it("excludes every exposure of the clicked status ID across sessions", async () => {
    await store.recordExposure(rec("1", "Rent is too high"), 0, NOW);
    await store.recordExposure(rec("1", "Rent is too high", { sessionId: S2 }), 0, NOW);
    await store.recordExposure(rec("2", "Rent went up 20%"), 0, NOW);
    await store.recordExposure(rec("3", "cat pictures"), 0, NOW);
    const r = await result(req("1", "Rent is too high"));
    expect(r.query.recorded).toBe(true);
    expect(r.metrics!.excludedSelf).toBe(2);
    expect(r.metrics!.all.current).toMatchObject({ eligible: 2, related: 1 });
    expect(r.evidence.map((e) => e.statusId)).toEqual(["2"]);
  });

  it("uses cached vectors on the next request (warm path encodes only the new query)", async () => {
    for (let i = 0; i < 20; i++) await store.recordExposure(rec(String(100 + i), `rent post number ${i}`), 0, NOW);
    await result(req("1", "rent is high"));
    const before = enc.texts;
    expect(before).toBe(21);
    const r = await result(req("2", "my cat"));
    expect(enc.texts - before).toBe(1);
    expect(r.timings.cached).toBe(20);
    expect(r.metrics!.all.current.related).toBe(0);
  });

  it("a different encoder identity never reuses cached vectors", async () => {
    await store.recordExposure(rec("5", "rent prices"), 0, NOW);
    // A vector stored under some other encoder key for the same text is ignored.
    await store.putEmbeddings([{ key: `0000000000000000:${(await embeddingKey("rent prices")).split(":")[1]}`, vec: new Float32Array([0, 0, 0, 1]), tokens: 1, chunks: 1, truncated: false, createdAt: NOW }], 0);
    const r = await result(req("1", "rent is high"));
    expect(r.metrics!.all.current.related).toBe(1);
    expect(enc.calls.flat()).toContain("rent prices");
  });

  it("legacy excerpt-only rows are analyzed and flagged; content-free rows are unassessable", async () => {
    await store.recordExposure(rec("6", null, { excerpt: "Rent went up again and I…", lang: undefined }), 0, NOW);
    await store.recordExposure(rec("7", "🔥🔥🔥"), 0, NOW);
    await store.recordExposure(rec("8", null, { excerpt: "" }), 0, NOW);
    const r = await result(req("1", "rent is high"));
    expect(r.metrics!.all.current).toMatchObject({ eligible: 3, assessed: 1, related: 1, unassessable: 2, assessedFromExcerpt: 1 });
    expect(r.metrics!.language.current.eligible).toBe(3); // missing language = legacy English
    expect(r.evidence[0]).toMatchObject({ statusId: "6", fromExcerpt: true });
    expect(enc.calls.flat()).toContain("Rent went up again and I");
  });

  it("insufficient query text and empty history are distinct outcomes", async () => {
    const r1 = await result(req("1", "🔥🔥 https://t.co/x"));
    expect(r1.outcome).toBe("insufficient-text");
    expect(enc.texts).toBe(0);
    const r2 = await result(req("1", "rent is high"));
    expect(r2.outcome).toBe("empty-history");
  });

  it("Stop keeps a partial result: unanalyzed rows stay pending, never unrelated", async () => {
    for (let i = 0; i < 40; i++) await store.recordExposure(rec(String(200 + i), `rent ${i}`), 0, NOW);
    let release!: () => void;
    enc.gate = new Promise((r) => (release = r));
    const r = req("1", "rent is high");
    svc.request(r);
    await new Promise((res) => setTimeout(res, 5));
    expect(svc.request(r)).toMatchObject({ phase: "working", total: 41 });
    svc.cancel(r.requestId, true);
    release();
    const res = await result(r);
    expect(res.partial).toBe(true);
    expect(res.metrics!.all.current.pending).toBe(25); // first batch of 16 (query + 15 rows) done
    expect(res.metrics!.all.current.assessed).toBe(15);
    expect(res.metrics!.all.change.status).not.toBe("ok");
  });

  it("deletion during encoding discards in-flight vectors and reports 'deleted'", async () => {
    await store.recordExposure(rec("1", "rent a"), 0, NOW);
    await store.recordExposure(rec("2", "rent b"), 0, NOW);
    let release!: () => void;
    enc.gate = new Promise((r) => (release = r));
    const r = req("9", "rent c");
    svc.request(r);
    await new Promise((res) => setTimeout(res, 5));
    const epoch = await store.clearAll(NOW);
    svc.reset(epoch);
    release();
    await new Promise((res) => setTimeout(res, 20));
    expect(await store.countEmbeddings()).toBe(0); // nothing resurrected
    // The old request is gone; a request from the old epoch is refused.
    const st = await settle(req("9", "rent c", "en", 0));
    expect(st).toMatchObject({ phase: "error", kind: "deleted" });
    const fresh = await result(req("9", "rent c", "en", epoch));
    expect(fresh.outcome).toBe("empty-history");
  });

  it("an encoder failure is an error state, never a zero-match result", async () => {
    await store.recordExposure(rec("1", "rent a"), 0, NOW);
    enc.fail = new EncoderFailure("model-unavailable", "missing model file");
    const st = await settle(req("2", "rent is high"));
    expect(st).toEqual({ phase: "error", kind: "model-unavailable", message: "missing model file" });
    // Retry after recovery works and reuses nothing stale.
    enc.fail = null;
    const r = await result(req("2", "rent is high"));
    expect(r.metrics!.all.current.related).toBe(1);
  });

  it("concurrent requests (two tabs) share encodes and agree", async () => {
    for (let i = 0; i < 10; i++) await store.recordExposure(rec(String(300 + i), i % 2 ? `rent ${i}` : `cat ${i}`), 0, NOW);
    const a = req("1", "rent is high");
    const b = req("1", "rent is high");
    svc.request(a);
    svc.request(b);
    const [ra, rb] = await Promise.all([result(a), result(b)]);
    expect(ra.metrics!.all.current.related).toBe(5);
    expect(rb.metrics!.all.current.related).toBe(5);
    expect(enc.texts).toBeLessThanOrEqual(12); // 10 rows + query, at most one duplicate query encode
    expect(await store.countEmbeddings()).toBe(10);
  });

  it("repeated polls of one request ID never start a second job", async () => {
    await store.recordExposure(rec("1", "rent a"), 0, NOW);
    const r = req("2", "rent is high");
    svc.request(r);
    svc.request(r);
    svc.request(r);
    await result(r);
    expect(enc.calls.length).toBe(1);
  });

  it("a request that is no longer polled is abandoned", async () => {
    let t = NOW;
    svc = new SemanticService({ store, encoder: enc, now: () => t });
    for (let i = 0; i < 40; i++) await store.recordExposure(rec(String(400 + i), `rent ${i}`), 0, NOW);
    let release!: () => void;
    enc.gate = new Promise((r) => (release = r));
    const r = req("1", "rent is high");
    svc.request(r);
    await new Promise((res) => setTimeout(res, 5));
    t += 60_000; // nobody polled for a minute (tab closed)
    svc.request(req("2", "my cat")); // any message runs the lease check
    release();
    await new Promise((res) => setTimeout(res, 30));
    expect(enc.calls.length).toBeLessThanOrEqual(3); // stopped after the in-flight batch
  });

  it("after a completed analysis, embeddings no retained exposure references are swept", async () => {
    await store.recordExposure(rec("1", "rent is high here"), 0, NOW);
    await store.putEmbeddings([{ key: "deadbeefdeadbeef:orphan", vec: new Float32Array(4), tokens: 1, chunks: 1, truncated: false, createdAt: NOW }], 0);
    await result(req("2", "my cat again"));
    await new Promise((res) => setTimeout(res, 20));
    const keys = await store.getEmbeddings(["deadbeefdeadbeef:orphan", await embeddingKey("rent is high here")]);
    expect([...keys.keys()]).toEqual([await embeddingKey("rent is high here")]);
  });
});
