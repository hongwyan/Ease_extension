import { formatPct } from "./format";
import { MIN_SAMPLE_FOR_DIRECTION, type PanelMetrics, type TopicMetrics } from "./metrics";
import type { SemanticScope } from "./semanticMetrics";

/**
 * One-sentence interpretation generated only from measured values.
 * No causal claims about X's ranking, nobody's income or the user's state.
 */
/**
 * `phrase` comes from the catalog, e.g. "mentioned ChatGPT".
 * `noun` names the denominator: "posts", "Japanese posts", "posts in all languages".
 */
export function interpretTopic(m: TopicMetrics, phrase: string, noun = "posts"): string {
  const c = m.current;
  const p = m.previous;
  if (c.total === 0) {
    return `No eligible ${noun} have been recorded in the last 7 days yet, so there is nothing to measure.`;
  }
  const curPart =
    c.matching === 0
      ? `None of ${c.total} recorded ${noun} in the last 7 days ${phrase}`
      : `${c.matching} of ${c.total} recorded ${noun} (${formatPct(c.pct)}) in the last 7 days ${phrase}`;

  if (p.total === 0) {
    return `${curPart}; no comparison yet, because no ${noun} were recorded in the previous 7 days.`;
  }
  const prevCounts = `${p.matching} of ${p.total} (${formatPct(p.pct)})`;
  switch (m.change.status) {
    case "insufficient":
      return (
        `${curPart}; the previous 7 days had ${prevCounts}, but a period has fewer than ` +
        `${MIN_SAMPLE_FOR_DIRECTION} recorded ${noun}, so no direction is stated.`
      );
    case "ok":
      if (m.change.direction === "up") return `${curPart}, up from ${prevCounts} in the previous 7 days.`;
      if (m.change.direction === "down") return `${curPart}, down from ${prevCounts} in the previous 7 days.`;
      return `${curPart}, about the same as ${prevCounts} in the previous 7 days.`;
    default:
      return `${curPart}.`;
  }
}

export function interpretUnknown(panel: PanelMetrics, noun = "posts"): string {
  const all = panel.currentTotal;
  if (all === 0) return `No eligible ${noun} have been recorded in the last 7 days yet.`;
  const none = panel.unmatchedCurrent;
  return (
    `${none} of ${all} recorded ${noun} (${formatPct((none / all) * 100)}) in the last 7 days ` +
    "also matched no topic; they still count in the denominator."
  );
}

/** Denominator noun for a language scope: "Japanese posts", "posts with undetermined language". */
export function languageNoun(lang: string, name: string): string {
  return lang === "und" ? "posts with undetermined language" : `${name} posts`;
}

export const ALL_LANGUAGES_NOUN = "posts across all languages";

/**
 * Semantic sentence for one language scope. `noun` names the denominator
 * ("English posts", "posts across all languages"). Counts are of OTHER recorded posts
 * that were analyzed; the clicked post itself is never counted.
 */
export function interpretSemantic(s: SemanticScope, noun: string): string {
  const c = s.current;
  const p = s.previous;
  const other = `other ${noun}`;
  if (c.eligible === 0) return `No ${other} were recorded in the last 7 days.`;
  if (c.assessed === 0) {
    return c.pending > 0
      ? `None of the ${c.eligible} ${other} from the last 7 days have been analyzed yet.`
      : `None of the ${c.eligible} ${other} from the last 7 days had enough text to analyze.`;
  }
  const curPart =
    c.related === 0
      ? `None of ${c.assessed} analyzed ${other} in the last 7 days looked related to this post`
      : `${c.related} of ${c.assessed} analyzed ${other} (${formatPct(c.share.pct)}) in the last 7 days looked related to this post`;
  const prevCounts = `${p.related} of ${p.assessed} (${formatPct(p.share.pct)})`;
  switch (s.change.status) {
    case "none":
      return `${curPart}; no comparison yet, because no ${other} were analyzed in the previous 7 days.`;
    case "incomplete":
      return `${curPart}; the previous 7 days had ${prevCounts}, but not every recorded post could be analyzed, so no direction is stated.`;
    case "insufficient":
      return (
        `${curPart}; the previous 7 days had ${prevCounts}, but a period has fewer than ` +
        `${MIN_SAMPLE_FOR_DIRECTION} analyzed posts, so no direction is stated.`
      );
    case "ok":
      if (s.change.direction === "up") return `${curPart}, up from ${prevCounts} in the previous 7 days.`;
      if (s.change.direction === "down") return `${curPart}, down from ${prevCounts} in the previous 7 days.`;
      return `${curPart}, about the same as ${prevCounts} in the previous 7 days.`;
  }
}
