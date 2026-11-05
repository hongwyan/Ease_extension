/**
 * All numeric results shown in the panel are computed here, in code.
 * Pure functions: no Chrome APIs, no DOM, so they are unit-tested directly.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIOD_DAYS = 7;
export const RETENTION_DAYS = 30;
/** Directional wording ("up", "down") is suppressed below this many exposures in either period. */
export const MIN_SAMPLE_FOR_DIRECTION = 20;
/** Changes smaller than this (in percentage points) are described as "about the same". */
export const FLAT_THRESHOLD_PP = 0.5;

export interface ExposureLike {
  ts: number;
  statusId: string;
  author: string | null;
  topics: string[];
  excerpt?: string;
  /** Normalized post language. Missing on rows recorded before v0.2 (English-only then). */
  lang?: string;
}

/** Rows recorded before multilingual support were English-only by construction. */
export const LEGACY_LANG = "en";

export function langOf(r: ExposureLike): string {
  return r.lang ?? LEGACY_LANG;
}

export interface Period {
  /** Inclusive start, epoch ms (local midnight). */
  start: number;
  /** Exclusive end, epoch ms (local midnight). */
  end: number;
}

/** Local midnight of the day containing `ts`. DST-safe (uses calendar arithmetic). */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addLocalDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * Current period: the last seven local calendar days, today included
 * ([today-6 00:00, tomorrow 00:00)). Previous period: the seven days before
 * that ([today-13 00:00, today-6 00:00)). Half-open, so they never overlap.
 */
export function comparisonPeriods(now: number): { current: Period; previous: Period } {
  const today = startOfLocalDay(now);
  const currentStart = addLocalDays(today, -(PERIOD_DAYS - 1));
  const currentEnd = addLocalDays(today, 1);
  const previousStart = addLocalDays(currentStart, -PERIOD_DAYS);
  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: currentStart },
  };
}

export function inPeriod(ts: number, p: Period): boolean {
  return ts >= p.start && ts < p.end;
}

export interface Share {
  matching: number;
  total: number;
  /** Percentage 0–100, or null when total is 0. */
  pct: number | null;
}

export function share(matching: number, total: number): Share {
  return { matching, total, pct: total > 0 ? (matching / total) * 100 : null };
}

export type Direction = "up" | "down" | "flat";

export interface Change {
  /** "none": no comparison possible (an empty denominator). */
  status: "none" | "insufficient" | "ok";
  /** current pct − previous pct, in percentage points (null when status is "none"). */
  pp: number | null;
  direction: Direction | null;
}

export function change(current: Share, previous: Share): Change {
  if (current.pct === null || previous.pct === null) {
    return { status: "none", pp: null, direction: null };
  }
  const pp = round1(current.pct - previous.pct);
  if (current.total < MIN_SAMPLE_FOR_DIRECTION || previous.total < MIN_SAMPLE_FOR_DIRECTION) {
    return { status: "insufficient", pp, direction: null };
  }
  const direction: Direction = Math.abs(pp) < FLAT_THRESHOLD_PP ? "flat" : pp > 0 ? "up" : "down";
  return { status: "ok", pp, direction };
}

export interface RepeatedSources {
  topicExposures: number;
  /** Exposures whose author handle was known. */
  knownAuthorExposures: number;
  distinctKnownAuthors: number;
  /** Exposures from the two most frequent known authors. */
  topTwoExposures: number;
  topAuthors: { author: string; count: number }[];
  /** topTwoExposures / topicExposures × 100; null when there are no topic exposures. */
  pct: number | null;
  /** True when every topic exposure has a known author. */
  fullCoverage: boolean;
}

export function repeatedSources(topicRows: ExposureLike[]): RepeatedSources {
  const counts = new Map<string, number>();
  let known = 0;
  for (const r of topicRows) {
    if (r.author) {
      known++;
      const key = r.author.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  // Deterministic: by count desc, then handle asc.
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const top = sorted.slice(0, 2).map(([author, count]) => ({ author, count }));
  const topTwo = top.reduce((s, a) => s + a.count, 0);
  return {
    topicExposures: topicRows.length,
    knownAuthorExposures: known,
    distinctKnownAuthors: counts.size,
    topTwoExposures: topTwo,
    topAuthors: top,
    pct: topicRows.length > 0 ? (topTwo / topicRows.length) * 100 : null,
    fullCoverage: known === topicRows.length,
  };
}

export interface PauseInterval {
  from: number;
  /** null while still paused. */
  to: number | null;
}

export interface PeriodInfo extends Period {
  /** Not observed for the whole period: recording started after it began (includes time before installation) or was paused. */
  partial: boolean;
  /** Recording was paused during this period. */
  pausedDuring: boolean;
  /** Period includes "now" and is still running. */
  ongoing: boolean;
  observedFrom: number;
}

export interface TopicMetrics {
  topicId: string;
  current: Share;
  previous: Share;
  change: Change;
  repeated: RepeatedSources;
  /** Up to three most recent distinct contributing posts in the current period. */
  evidence: ExposureLike[];
}

export interface PanelMetrics {
  now: number;
  current: PeriodInfo;
  previous: PeriodInfo;
  /** All eligible exposures (the denominator) per period. */
  currentTotal: number;
  previousTotal: number;
  /** Eligible exposures in the current period that matched no catalog topic. */
  unmatchedCurrent: number;
  /** Total retained exposures (≤ 30 days). */
  retainedTotal: number;
  topics: TopicMetrics[];
}

export function computePanelMetrics(
  rows: ExposureLike[],
  topicIds: string[],
  now: number,
  trackingSince: number | null,
  pauses: PauseInterval[] = [],
): PanelMetrics {
  const { current, previous } = comparisonPeriods(now);
  const cur = rows.filter((r) => inPeriod(r.ts, current) && r.ts <= now);
  const prev = rows.filter((r) => inPeriod(r.ts, previous));
  const observedFrom = trackingSince ?? now;
  const info = (p: Period, ongoing: boolean): PeriodInfo => {
    const pausedDuring = pauses.some((x) => x.from < Math.min(p.end, now) && (x.to ?? now) > p.start);
    return { ...p, partial: observedFrom > p.start || pausedDuring, pausedDuring, ongoing, observedFrom };
  };

  const topics = topicIds.map((topicId): TopicMetrics => {
    const curTopic = cur.filter((r) => r.topics.includes(topicId));
    const prevTopic = prev.filter((r) => r.topics.includes(topicId));
    const cs = share(curTopic.length, cur.length);
    const ps = share(prevTopic.length, prev.length);
    const seen = new Set<string>();
    const evidence = [...curTopic]
      .sort((a, b) => b.ts - a.ts)
      .filter((r) => (seen.has(r.statusId) ? false : (seen.add(r.statusId), true)))
      .slice(0, 3);
    return {
      topicId,
      current: cs,
      previous: ps,
      change: change(cs, ps),
      repeated: repeatedSources(curTopic),
      evidence,
    };
  });

  return {
    now,
    current: info(current, true),
    previous: info(previous, false),
    currentTotal: cur.length,
    previousTotal: prev.length,
    unmatchedCurrent: cur.filter((r) => r.topics.length === 0).length,
    retainedTotal: rows.length,
    topics,
  };
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export interface ScopedMetrics {
  /** The clicked post's language. */
  lang: string;
  /** Metrics where every denominator is posts in `lang` only. */
  language: PanelMetrics;
  /** Metrics where every denominator is posts in all languages. */
  all: PanelMetrics;
}

/** Same metrics twice: within the post's language, and across all languages. */
export function computeScopedMetrics(
  rows: ExposureLike[],
  topicIds: string[],
  lang: string,
  now: number,
  trackingSince: number | null,
  pauses: PauseInterval[] = [],
): ScopedMetrics {
  return {
    lang,
    language: computePanelMetrics(
      rows.filter((r) => langOf(r) === lang),
      topicIds,
      now,
      trackingSince,
      pauses,
    ),
    all: computePanelMetrics(rows, topicIds, now, trackingSince, pauses),
  };
}
