import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { FeedStore } from "../../src/background/db";
import { TrendService } from "../../src/background/trend";
import { queryRange } from "../../src/shared/wiki";
import { wikiItems } from "../fixtures/wikiData";

const NOW = Date.parse("2026-11-04T14:00:00Z");
const RANGE = queryRange(NOW);

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

function setup(fetchImpl: FetchImpl, enabled = true) {
  const store = new FeedStore(new IDBFactory(), "t");
  const calls: { url: string; init: RequestInit }[] = [];
  let now = NOW;
  const svc = new TrendService({
    store,
    fetch: ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    }) as unknown as typeof fetch,
    now: () => now,
    publicLookupsEnabled: async () => enabled,
    timeoutMs: 50,
  });
  return { svc, store, calls, setNow: (t: number) => (now = t) };
}

const ok = (article = "ChatGPT") =>
  new Response(JSON.stringify(wikiItems(article, RANGE.start, RANGE.end, () => 100)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("TrendService", () => {
  it("does nothing when public lookups are disabled", async () => {
    const { svc, calls } = setup(async () => ok(), false);
    expect(await svc.lookup("chatgpt")).toEqual({ status: "disabled" });
    expect(calls).toHaveLength(0);
  });

  it("never requests a series for earning money with AI", async () => {
    const { svc, calls } = setup(async () => ok());
    const r = await svc.lookup("ai-earnings");
    expect(r.status).toBe("no-series");
    expect(calls).toHaveLength(0);
  });

  it("sends only article + date range, with Api-User-Agent and no credentials", async () => {
    const { svc, calls } = setup(async () => ok("Claude_(AI)"));
    const r = await svc.lookup("claude-ai");
    expect(r.status).toBe("ok");
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.search).toBe("");
    expect(u.pathname).toBe(
      "/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/Claude_(AI)/daily/2026101400/2026110300",
    );
    expect(calls[0]!.init.credentials).toBe("omit");
    expect((calls[0]!.init.headers as Record<string, string>)["Api-User-Agent"]).toMatch(/^XFeedLens\//);
  });

  it("caches successful responses by article and date range", async () => {
    const { svc, calls } = setup(async () => ok());
    const a = await svc.lookup("chatgpt");
    const b = await svc.lookup("chatgpt");
    expect(a).toMatchObject({ status: "ok", fromCache: false });
    expect(b).toMatchObject({ status: "ok", fromCache: true });
    expect(calls).toHaveLength(1);
  });

  it("falls back to the cached result when offline", async () => {
    let online = true;
    const { svc, setNow } = setup(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return ok();
    });
    await svc.lookup("chatgpt");
    online = false;
    setNow(NOW + 86_400_000); // next day → new date range, cache miss
    const r = await svc.lookup("chatgpt");
    expect(r).toMatchObject({ status: "error", kind: "offline" });
    expect(r.status === "error" && r.cached?.trend.article).toBe("ChatGPT");
  });

  it("times out slow lookups", async () => {
    const { svc } = setup(
      (_u, init) =>
        new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    );
    expect(await svc.lookup("chatgpt")).toMatchObject({ status: "error", kind: "timeout" });
  });

  it("handles rate limiting and backs off", async () => {
    const { svc, calls } = setup(async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    expect(await svc.lookup("chatgpt")).toMatchObject({ status: "error", kind: "rate-limited" });
    expect(await svc.lookup("chatgpt")).toMatchObject({ status: "error", kind: "rate-limited" });
    expect(calls).toHaveLength(1);
  });

  it("handles missing data (404) and invalid payloads", async () => {
    const a = setup(async () => new Response("{}", { status: 404 }));
    expect(await a.svc.lookup("chatgpt")).toMatchObject({ status: "error", kind: "no-data" });
    const b = setup(async () => new Response(JSON.stringify({ items: [{ bad: 1 }] }), { status: 200 }));
    expect(await b.svc.lookup("chatgpt")).toMatchObject({ status: "error", kind: "invalid" });
  });

  it("an in-flight lookup cannot repopulate the cache after Delete data", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { svc, store } = setup(async () => {
      await gate;
      return ok();
    });
    const p = svc.lookup("chatgpt");
    await new Promise((r) => setTimeout(r, 10));
    await store.clearAll(NOW);
    release();
    expect((await p).status).toBe("ok");
    expect(await store.latestCacheForArticle("ChatGPT")).toBeUndefined();
  });
});
