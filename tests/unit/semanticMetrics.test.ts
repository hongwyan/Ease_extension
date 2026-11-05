import { describe, expect, it } from "vitest";
import { addLocalDays, startOfLocalDay } from "../../src/shared/metrics";
import { interpretSemantic } from "../../src/shared/interpret";
import {
  computeSemanticMetrics,
  pickEvidence,
  semanticChange,
  semanticCounts,
  type AssessedRow,
  type Relatedness,
} from "../../src/shared/semanticMetrics";

const NOW = new Date(2026, 10, 5, 15, 0, 0).getTime();
const TODAY = startOfLocalDay(NOW);
const CUR = addLocalDays(TODAY, -2) + 3600_000; // inside the current 7-day period
const PREV = addLocalDays(TODAY, -9) + 3600_000; // inside the previous period

let n = 0;
function row(rel: Relatedness, ts: number, extra: Partial<AssessedRow> = {}): AssessedRow {
  n++;
  return {
    statusId: String(1_000_000 + n),
    author: `a${n % 5}`,
    ts: ts + n,
    topics: [],
    lang: "en",
    relatedness: rel,
    score: rel === "related" ? 0.8 : rel === "unrelated" ? 0.3 : null,
    fromExcerpt: false,
    ...extra,
  };
}
const many = (count: number, rel: Relatedness, ts: number, extra: Partial<AssessedRow> = {}) =>
  Array.from({ length: count }, () => row(rel, ts, extra));

describe("semantic statistics", () => {
  it("12/80 vs 3/75 assessed after exclusions → 15%, 4%, +11 pp, up", () => {
    const clicked = "999";
    const rows = [
      ...many(12, "related", CUR),
      ...many(68, "unrelated", CUR),
      ...many(3, "related", PREV),
      ...many(72, "unrelated", PREV),
      // Exposures of the clicked post itself (two sessions, both periods) are excluded everywhere.
      row("related", CUR, { statusId: clicked }),
      row("related", CUR, { statusId: clicked, author: "other" }),
      row("related", PREV, { statusId: clicked }),
    ];
    const m = computeSemanticMetrics(rows, clicked, "en", NOW, NOW - 30 * 86_400_000);
    expect(m.excludedSelf).toBe(3);
    const s = m.all;
    expect(s.current).toMatchObject({ eligible: 80, assessed: 80, related: 12, pending: 0, unassessable: 0 });
    expect(s.previous).toMatchObject({ eligible: 75, assessed: 75, related: 3 });
    expect(s.current.share.pct).toBe(15);
    expect(s.previous.share.pct).toBe(4);
    expect(s.change).toEqual({ status: "ok", pp: 11, direction: "up" });
    expect(m.language.current.share.pct).toBe(15);
    expect(interpretSemantic(s, "posts across all languages")).toBe(
      "12 of 80 analyzed other posts across all languages (15%) in the last 7 days looked related to this post, " +
        "up from 3 of 75 (4%) in the previous 7 days.",
    );
  });

  it("pending and unassessable rows are never counted as unrelated; coverage = assessed / eligible", () => {
    const rows = [...many(2, "related", CUR), ...many(6, "unrelated", CUR), ...many(1, "pending", CUR), ...many(1, "unassessable", CUR)];
    const c = semanticCounts(rows);
    expect(c).toMatchObject({ eligible: 10, assessed: 8, related: 2, pending: 1, unassessable: 1 });
    expect(c.share.pct).toBe(25); // 2 / 8, not 2 / 10
    expect(c.coverage).toBe(80);
  });

  it("direction needs complete assessment and ≥ 20 assessed per period", () => {
    const full = (related: number, total: number, extra: Relatedness[] = []) =>
      semanticCounts([...many(related, "related", CUR), ...many(total - related, "unrelated", CUR), ...extra.map((r) => row(r, CUR))]);
    expect(semanticChange(full(10, 40), full(2, 40)).status).toBe("ok");
    expect(semanticChange(full(10, 40, ["unassessable"]), full(2, 40))).toEqual({ status: "incomplete", pp: null, direction: null });
    expect(semanticChange(full(10, 40), full(2, 40, ["pending"])).status).toBe("incomplete");
    expect(semanticChange(full(5, 19), full(2, 40)).status).toBe("insufficient");
    expect(semanticChange(full(5, 19), semanticCounts([])).status).toBe("none");
    expect(semanticChange(full(10, 40), full(10, 40))).toEqual({ status: "ok", pp: 0, direction: "flat" });
  });

  it("all-unmatched catalog history does not become one semantic topic", () => {
    // Every row has no catalog topic; relatedness comes only from the encoder's judgement.
    const rows = [...many(3, "related", CUR, { topics: [] }), ...many(37, "unrelated", CUR, { topics: [] })];
    const m = computeSemanticMetrics(rows, "x", "en", NOW, null);
    expect(m.all.current.share.pct).toBe(7.5);
    expect(m.all.current.related).toBe(3);
  });

  it("language scope counts only the clicked post's language; legacy rows count as English", () => {
    const rows = [
      ...many(2, "related", CUR, { lang: "zh" }),
      ...many(3, "unrelated", CUR, { lang: "zh" }),
      ...many(1, "related", CUR, { lang: undefined }),
      ...many(4, "unrelated", CUR, { lang: "en" }),
    ];
    const zh = computeSemanticMetrics(rows, "x", "zh", NOW, null);
    expect(zh.language.current).toMatchObject({ eligible: 5, related: 2 });
    expect(zh.all.current).toMatchObject({ eligible: 10, related: 3 });
    const en = computeSemanticMetrics(rows, "x", "en", NOW, null);
    expect(en.language.current).toMatchObject({ eligible: 5, related: 1 });
  });

  it("period boundaries: rows outside both periods and in the future are ignored", () => {
    const rows = [
      row("related", addLocalDays(TODAY, -6)), // first instant of the current period
      row("related", addLocalDays(TODAY, -6) - 1 - 1_000_000), // previous period
      row("related", addLocalDays(TODAY, -13) - 10_000_000), // before the previous period
      row("related", NOW + 3600_000), // future
    ];
    const m = computeSemanticMetrics(rows, "x", "en", NOW, null);
    expect(m.all.current.eligible).toBe(1);
    expect(m.all.previous.eligible).toBe(1);
  });

  it("excerpt-analyzed rows are reported separately", () => {
    const rows = [...many(2, "related", CUR, { fromExcerpt: true }), ...many(1, "unrelated", CUR), ...many(1, "unassessable", CUR, { fromExcerpt: true })];
    expect(semanticCounts(rows).assessedFromExcerpt).toBe(2);
  });

  it("repeated authors are computed over related posts only", () => {
    const rows = [
      row("related", CUR, { author: "ann" }),
      row("related", CUR, { author: "ann" }),
      row("related", CUR, { author: "bob" }),
      row("related", CUR, { author: "cy" }),
      row("unrelated", CUR, { author: "ann" }),
    ];
    const m = computeSemanticMetrics(rows, "x", "en", NOW, null);
    expect(m.all.repeated).toMatchObject({ topicExposures: 4, topTwoExposures: 3, distinctKnownAuthors: 3 });
    expect(m.all.repeated.pct).toBe(75);
  });

  it("evidence: up to three distinct related posts, most similar first, never the clicked post", () => {
    const rows = [
      row("related", CUR, { statusId: "a", score: 0.7 }),
      row("related", CUR, { statusId: "a", score: 0.7 }),
      row("related", CUR, { statusId: "b", score: 0.9 }),
      row("related", CUR, { statusId: "self", score: 1 }),
      row("unrelated", CUR, { statusId: "c", score: 0.5 }),
      row("related", PREV, { statusId: "d", score: 0.8 }),
      row("related", CUR, { statusId: "e", score: 0.65 }),
    ];
    expect(pickEvidence(rows, "self").map((r) => r.statusId)).toEqual(["b", "d", "a"]);
  });

  it("sentences for empty, unanalyzed and partial states never claim zero matches", () => {
    const pendingOnly = computeSemanticMetrics(many(4, "pending", CUR), "x", "en", NOW, null).all;
    expect(interpretSemantic(pendingOnly, "posts")).toBe("None of the 4 other posts from the last 7 days have been analyzed yet.");
    const noText = computeSemanticMetrics(many(2, "unassessable", CUR), "x", "en", NOW, null).all;
    expect(interpretSemantic(noText, "posts")).toBe("None of the 2 other posts from the last 7 days had enough text to analyze.");
    const empty = computeSemanticMetrics([], "x", "en", NOW, null).all;
    expect(interpretSemantic(empty, "posts")).toBe("No other posts were recorded in the last 7 days.");
  });
});
