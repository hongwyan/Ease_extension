/**
 * English Wikipedia article pageviews via the Wikimedia Analytics API
 * (per-article endpoint, daily granularity, agent=user, all-access).
 * https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html
 *
 * Only a catalog article title and a date range ever appear in the request.
 * This module is pure (no fetch) so validation and period logic are unit-tested.
 */

export const WIKI_BASE =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user";

/**
 * Browser clients cannot set User-Agent; Wikimedia's access policy asks them to
 * send Api-User-Agent instead. Contains no user data.
 */
export const API_USER_AGENT = "XFeedLens/0.1.0 (Chrome extension; local install, no backend)";

/** Days requested, ending yesterday (UTC). Leaves room for up to 7 days of publication delay. */
export const QUERY_DAYS = 21;
/** The latest available day is "delayed" if it is older than this many days before yesterday. */
export const DELAY_TOLERANCE_DAYS = 2;
export const WIKI_FLAT_THRESHOLD_PCT = 2;

const DAY = 86_400_000;

/** "YYYY-MM-DD" for the UTC day containing ts. */
export function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function dayToTs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  return utcDay(dayToTs(day) + n * DAY);
}

export interface QueryRange {
  /** Inclusive UTC days, "YYYY-MM-DD". */
  start: string;
  end: string;
}

export function queryRange(now: number): QueryRange {
  const end = addDays(utcDay(now), -1);
  return { start: addDays(end, -(QUERY_DAYS - 1)), end };
}

export function compact(day: string): string {
  return day.replaceAll("-", "");
}

export function buildUrl(article: string, range: QueryRange): string {
  if (!/^[A-Za-z0-9_().,'%-]+$/.test(article)) throw new Error("Unexpected article identifier");
  return `${WIKI_BASE}/${encodeURIComponent(article)}/daily/${compact(range.start)}00/${compact(range.end)}00`;
}

export function articleUrl(article: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(article)}`;
}

export class ValidationError extends Error {}

/** Validates the API payload and returns views per UTC day. Throws ValidationError. */
export function parseResponse(json: unknown, article: string, range: QueryRange): Map<string, number> {
  if (!json || typeof json !== "object" || !Array.isArray((json as { items?: unknown }).items)) {
    throw new ValidationError("Response has no items array");
  }
  const items = (json as { items: unknown[] }).items;
  const out = new Map<string, number>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") throw new ValidationError("Item is not an object");
    const it = raw as Record<string, unknown>;
    if (it.project !== "en.wikipedia") throw new ValidationError("Unexpected project");
    if (it.article !== article) throw new ValidationError("Unexpected article");
    if (it.granularity !== "daily") throw new ValidationError("Unexpected granularity");
    const ts = it.timestamp;
    if (typeof ts !== "string" || !/^\d{8}00$/.test(ts)) throw new ValidationError("Bad timestamp");
    const day = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    // Round-trip check rejects impossible dates such as 2026-02-31.
    const parsed = dayToTs(day);
    if (Number.isNaN(parsed) || utcDay(parsed) !== day) throw new ValidationError("Invalid date");
    if (day < range.start || day > range.end) throw new ValidationError("Date outside requested range");
    const views = it.views;
    if (typeof views !== "number" || !Number.isInteger(views) || views < 0) throw new ValidationError("Bad views");
    if (out.has(day)) throw new ValidationError("Duplicate day");
    out.set(day, views);
  }
  return out;
}

export interface WikiPeriod {
  start: string;
  end: string;
  total: number;
  /** Days in the period with no data point. */
  missingDays: number;
}

export type WikiDirection = "up" | "down" | "flat" | "up-from-zero" | "zero";

export interface WikiTrend {
  article: string;
  articleUrl: string;
  current: WikiPeriod;
  previous: WikiPeriod;
  /** Null when either period is missing days (no direction is stated then). */
  direction: WikiDirection | null;
  /** Percent change of totals; null for a zero baseline or incomplete data. */
  pctChange: number | null;
  latestDay: string;
  delayed: boolean;
  incomplete: boolean;
}

function period(days: Map<string, number>, start: string, end: string): WikiPeriod {
  let total = 0;
  let missing = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const v = days.get(d);
    if (v === undefined) missing++;
    else total += v;
  }
  return { start, end, total, missingDays: missing };
}

/**
 * Picks the latest two complete, adjacent seven-day periods in the data.
 * If no fully complete pair exists, uses the pair ending on the latest
 * available day and reports the missing days (direction suppressed).
 */
export function computeTrend(days: Map<string, number>, article: string, range: QueryRange): WikiTrend | null {
  if (days.size === 0) return null;
  const sorted = [...days.keys()].sort();
  const latest = sorted[sorted.length - 1]!;
  let end = latest;
  let chosen: { cur: WikiPeriod; prev: WikiPeriod } | null = null;
  for (let e = latest; addDays(e, -13) >= range.start; e = addDays(e, -1)) {
    const cur = period(days, addDays(e, -6), e);
    const prev = period(days, addDays(e, -13), addDays(e, -7));
    if (cur.missingDays === 0 && prev.missingDays === 0) {
      chosen = { cur, prev };
      end = e;
      break;
    }
  }
  if (!chosen) {
    end = latest;
    chosen = { cur: period(days, addDays(end, -6), end), prev: period(days, addDays(end, -13), addDays(end, -7)) };
  }
  const { cur, prev } = chosen;
  const incomplete = cur.missingDays > 0 || prev.missingDays > 0;
  let direction: WikiDirection | null = null;
  let pctChange: number | null = null;
  if (!incomplete) {
    if (prev.total === 0) {
      direction = cur.total > 0 ? "up-from-zero" : "zero";
    } else {
      pctChange = ((cur.total - prev.total) / prev.total) * 100;
      direction = Math.abs(pctChange) < WIKI_FLAT_THRESHOLD_PCT ? "flat" : pctChange > 0 ? "up" : "down";
    }
  }
  return {
    article,
    articleUrl: articleUrl(article),
    current: cur,
    previous: prev,
    direction,
    pctChange,
    latestDay: end,
    delayed: end < addDays(range.end, -DELAY_TOLERANCE_DAYS),
    incomplete,
  };
}

export type TrendErrorKind = "timeout" | "rate-limited" | "offline" | "http" | "invalid" | "no-data";

export type TrendResult =
  | { status: "disabled" }
  | { status: "no-series"; reason: string }
  | { status: "ok"; trend: WikiTrend; fetchedAt: number; fromCache: boolean }
  | {
      status: "error";
      kind: TrendErrorKind;
      message: string;
      /** Most recent cached result for this article, if any. */
      cached?: { trend: WikiTrend; fetchedAt: number };
    };
