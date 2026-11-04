import { topicById } from "../shared/catalog";
import {
  API_USER_AGENT,
  ValidationError,
  buildUrl,
  computeTrend,
  parseResponse,
  queryRange,
  type TrendErrorKind,
  type TrendResult,
} from "../shared/wiki";
import type { FeedStore } from "./db";

export const TREND_TIMEOUT_MS = 8000;

export interface TrendDeps {
  store: FeedStore;
  fetch: typeof fetch;
  now: () => number;
  publicLookupsEnabled: () => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Looks up the public series for a topic. Never throws; every failure becomes a
 * TrendResult the panel can render. Requests are serialized (Wikimedia asks
 * clients to wait for each request before sending the next) and identical
 * in-flight requests are shared.
 */
export class TrendService {
  private queue: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<TrendResult>>();
  private rateLimitedUntil = 0;

  constructor(private readonly deps: TrendDeps) {}

  async lookup(topicId: string): Promise<TrendResult> {
    const topic = topicById(topicId);
    if (!topic) return { status: "error", kind: "invalid", message: "Unknown topic." };
    if (!topic.wikipedia) {
      return { status: "no-series", reason: topic.noPublicSeriesReason ?? "No comparable public series." };
    }
    if (!(await this.deps.publicLookupsEnabled())) return { status: "disabled" };

    const article = topic.wikipedia.article;
    const range = queryRange(this.deps.now());
    const key = `${article}|${range.start}|${range.end}`;

    const hit = await this.deps.store.getCache(key);
    if (hit) return { status: "ok", trend: hit.trend, fetchedAt: hit.fetchedAt, fromCache: true };

    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = this.enqueue(() => this.fetchAndCache(article, range, key)).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fail(article: string, kind: TrendErrorKind, message: string): Promise<TrendResult> {
    const cached = await this.deps.store.latestCacheForArticle(article).catch(() => undefined);
    return {
      status: "error",
      kind,
      message,
      ...(cached ? { cached: { trend: cached.trend, fetchedAt: cached.fetchedAt } } : {}),
    };
  }

  private async fetchAndCache(
    article: string,
    range: { start: string; end: string },
    key: string,
  ): Promise<TrendResult> {
    const now = this.deps.now();
    if (now < this.rateLimitedUntil) {
      return this.fail(article, "rate-limited", "Wikimedia asked us to slow down; try again shortly.");
    }
    const epoch = (await this.deps.store.getMeta()).epoch;
    const ctrl = new AbortController();
    const timeoutMs = this.deps.timeoutMs ?? TREND_TIMEOUT_MS;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.deps.fetch(buildUrl(article, range), {
        method: "GET",
        headers: { Accept: "application/json", "Api-User-Agent": API_USER_AGENT },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (ctrl.signal.aborted) return this.fail(article, "timeout", `Wikimedia did not answer within ${timeoutMs / 1000} seconds.`);
      return this.fail(article, "offline", "Could not reach Wikimedia (offline or blocked).");
    }
    try {
      if (res.status === 429) {
        const retry = Number(res.headers.get("Retry-After"));
        this.rateLimitedUntil = now + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : 60_000);
        return this.fail(article, "rate-limited", "Wikimedia rate limit reached; try again shortly.");
      }
      if (res.status === 404) {
        return this.fail(article, "no-data", "Wikimedia has no pageview data for this article and period yet.");
      }
      if (!res.ok) return this.fail(article, "http", `Wikimedia returned HTTP ${res.status}.`);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        if (ctrl.signal.aborted) return this.fail(article, "timeout", `Wikimedia did not answer within ${timeoutMs / 1000} seconds.`);
        return this.fail(article, "invalid", "Wikimedia returned a response that is not JSON.");
      }
      const days = parseResponse(json, article, range);
      const trend = computeTrend(days, article, range);
      if (!trend) return this.fail(article, "no-data", "Wikimedia returned no days for this period.");
      const fetchedAt = this.deps.now();
      await this.deps.store.putCache({ key, article, start: range.start, end: range.end, trend, fetchedAt }, epoch);
      return { status: "ok", trend, fetchedAt, fromCache: false };
    } catch (e) {
      if (e instanceof ValidationError) {
        return this.fail(article, "invalid", `Wikimedia data failed validation (${e.message}).`);
      }
      return this.fail(article, "http", "Unexpected error reading Wikimedia data.");
    } finally {
      clearTimeout(timer);
    }
  }
}
