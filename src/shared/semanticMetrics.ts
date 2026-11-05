/**
 * Statistics for the semantic "Similar to this post" view. Pure functions, unit-tested.
 *
 * Every exposure of the clicked status ID is excluded from both numerator and denominator in
 * both periods, so the clicked post can never prove its own prevalence. Each remaining
 * exposure is related, unrelated (both "assessed"), unassessable (no usable text), or pending
 * (not encoded yet). The displayed share is related / assessed; coverage is assessed / eligible.
 * Pending or unassessable rows are never counted as unrelated.
 */
import {
  FLAT_THRESHOLD_PP,
  MIN_SAMPLE_FOR_DIRECTION,
  inPeriod,
  langOf,
  periodInfos,
  repeatedSources,
  round1,
  share,
  type Direction,
  type ExposureLike,
  type PauseInterval,
  type PeriodInfo,
  type RepeatedSources,
  type Share,
} from "./metrics";

export type Relatedness = "related" | "unrelated" | "unassessable" | "pending";

export interface AssessedRow extends ExposureLike {
  relatedness: Relatedness;
  /** Cosine similarity to the clicked post; null unless assessed. */
  score: number | null;
  /** Analyzed from a pre-v0.3 140-character excerpt instead of stored analysis text. */
  fromExcerpt: boolean;
}

export interface SemanticCounts {
  /** Other exposures in this period and language scope (the clicked post excluded). */
  eligible: number;
  /** related + unrelated. */
  assessed: number;
  related: number;
  unassessable: number;
  pending: number;
  /** Assessed rows that were analyzed from an older excerpt. */
  assessedFromExcerpt: number;
  /** related / assessed. */
  share: Share;
  /** assessed / eligible × 100, null when eligible is 0. */
  coverage: number | null;
}

export interface SemanticChange {
  /**
   * none: a period has no assessed posts. incomplete: some eligible posts are pending or
   * unassessable, so no headline change is stated. insufficient: fewer than 20 assessed posts
   * in a period. ok: direction stated.
   */
  status: "none" | "incomplete" | "insufficient" | "ok";
  pp: number | null;
  direction: Direction | null;
}

export interface SemanticScope {
  current: SemanticCounts;
  previous: SemanticCounts;
  change: SemanticChange;
  /** Repeated authors among related exposures in the current period. */
  repeated: RepeatedSources;
}

export interface SemanticMetrics {
  lang: string;
  now: number;
  currentInfo: PeriodInfo;
  previousInfo: PeriodInfo;
  /** Exposures of the clicked status ID removed from both periods (all languages). */
  excludedSelf: number;
  language: SemanticScope;
  all: SemanticScope;
}

export function semanticCounts(rows: AssessedRow[]): SemanticCounts {
  let related = 0;
  let unrelated = 0;
  let unassessable = 0;
  let pending = 0;
  let fromExcerpt = 0;
  for (const r of rows) {
    if (r.relatedness === "related") related++;
    else if (r.relatedness === "unrelated") unrelated++;
    else if (r.relatedness === "unassessable") unassessable++;
    else pending++;
    if ((r.relatedness === "related" || r.relatedness === "unrelated") && r.fromExcerpt) fromExcerpt++;
  }
  const assessed = related + unrelated;
  return {
    eligible: rows.length,
    assessed,
    related,
    unassessable,
    pending,
    assessedFromExcerpt: fromExcerpt,
    share: share(related, assessed),
    coverage: rows.length > 0 ? (assessed / rows.length) * 100 : null,
  };
}

export function semanticChange(cur: SemanticCounts, prev: SemanticCounts): SemanticChange {
  if (cur.assessed === 0 || prev.assessed === 0 || cur.share.pct === null || prev.share.pct === null) {
    return { status: "none", pp: null, direction: null };
  }
  if (cur.pending + cur.unassessable + prev.pending + prev.unassessable > 0) {
    return { status: "incomplete", pp: null, direction: null };
  }
  const pp = round1(cur.share.pct - prev.share.pct);
  if (cur.assessed < MIN_SAMPLE_FOR_DIRECTION || prev.assessed < MIN_SAMPLE_FOR_DIRECTION) {
    return { status: "insufficient", pp, direction: null };
  }
  const direction: Direction = Math.abs(pp) < FLAT_THRESHOLD_PP ? "flat" : pp > 0 ? "up" : "down";
  return { status: "ok", pp, direction };
}

function scope(rows: AssessedRow[], current: PeriodInfo, previous: PeriodInfo, now: number): SemanticScope {
  const cur = rows.filter((r) => inPeriod(r.ts, current) && r.ts <= now);
  const prev = rows.filter((r) => inPeriod(r.ts, previous));
  const c = semanticCounts(cur);
  const p = semanticCounts(prev);
  return {
    current: c,
    previous: p,
    change: semanticChange(c, p),
    repeated: repeatedSources(cur.filter((r) => r.relatedness === "related")),
  };
}

export function computeSemanticMetrics(
  rows: AssessedRow[],
  clickedStatusId: string,
  lang: string,
  now: number,
  trackingSince: number | null,
  pauses: PauseInterval[] = [],
): SemanticMetrics {
  const { current, previous } = periodInfos(now, trackingSince, pauses);
  const inWindow = rows.filter((r) => (inPeriod(r.ts, current) && r.ts <= now) || inPeriod(r.ts, previous));
  const others = inWindow.filter((r) => r.statusId !== clickedStatusId);
  return {
    lang,
    now,
    currentInfo: current,
    previousInfo: previous,
    excludedSelf: inWindow.length - others.length,
    language: scope(
      others.filter((r) => langOf(r) === lang),
      current,
      previous,
      now,
    ),
    all: scope(others, current, previous, now),
  };
}

/** Up to `max` distinct related posts, most similar first (ties: most recent). */
export function pickEvidence<T extends AssessedRow>(rows: T[], clickedStatusId: string, max = 3): T[] {
  const seen = new Set<string>([clickedStatusId]);
  return rows
    .filter((r) => r.relatedness === "related")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.ts - a.ts)
    .filter((r) => (seen.has(r.statusId) ? false : (seen.add(r.statusId), true)))
    .slice(0, max);
}
