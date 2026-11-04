import { describe, expect, it } from "vitest";
import { formatPct, formatPeriod, formatPp } from "../../src/shared/format";
import { interpretTopic, interpretUnknown } from "../../src/shared/interpret";
import {
  addLocalDays,
  change,
  comparisonPeriods,
  computePanelMetrics,
  repeatedSources,
  share,
  startOfLocalDay,
  type ExposureLike,
} from "../../src/shared/metrics";

const NOW = new Date(2026, 10, 4, 15, 30).getTime(); // Nov 4 2026, 15:30 local

function rows(n: number, matching: number, dayOffset: number, topic = "chatgpt", startId = 0): ExposureLike[] {
  const ts = addLocalDays(startOfLocalDay(NOW), dayOffset) + 12 * 3600_000;
  return Array.from({ length: n }, (_, i) => ({
    ts: ts + i,
    statusId: String(startId + i + 1),
    author: `author${i % 7}`,
    topics: i < matching ? [topic] : [],
    excerpt: `post ${i}`,
  }));
}

describe("seeded 12/80 vs 3/75", () => {
  const history = [...rows(80, 12, -2, "chatgpt", 0), ...rows(75, 3, -9, "chatgpt", 1000)];
  const m = computePanelMetrics(history, ["chatgpt"], NOW, addLocalDays(NOW, -20));
  const t = m.topics[0]!;

  it("computes 15 %, 4 % and +11 percentage points", () => {
    expect(t.current).toMatchObject({ matching: 12, total: 80 });
    expect(t.previous).toMatchObject({ matching: 3, total: 75 });
    expect(formatPct(t.current.pct)).toBe("15%");
    expect(formatPct(t.previous.pct)).toBe("4%");
    expect(t.change).toMatchObject({ status: "ok", direction: "up" });
    expect(formatPp(t.change.pp!)).toBe("+11");
  });

  it("generates the interpretation from measured values", () => {
    expect(interpretTopic(t, "mentioned ChatGPT")).toBe(
      "12 of 80 recorded posts (15%) in the last 7 days mentioned ChatGPT, up from 3 of 75 (4%) in the previous 7 days.",
    );
  });

  it("is not partial when tracking started before both periods", () => {
    expect(m.current.partial).toBe(false);
    expect(m.previous.partial).toBe(false);
  });

  it("returns up to three distinct evidence posts, newest first", () => {
    expect(t.evidence).toHaveLength(3);
    expect(t.evidence[0]!.ts).toBeGreaterThan(t.evidence[1]!.ts);
  });
});

describe("periods", () => {
  it("are explicit, adjacent and non-overlapping 7-day local windows", () => {
    const { current, previous } = comparisonPeriods(NOW);
    expect(previous.end).toBe(current.start);
    expect(new Date(current.start)).toEqual(new Date(2026, 9, 29));
    expect(new Date(current.end)).toEqual(new Date(2026, 10, 5));
    expect(new Date(previous.start)).toEqual(new Date(2026, 9, 22));
    expect(formatPeriod(current.start, current.end)).toBe("Oct 29 – Nov 4");
    expect(formatPeriod(previous.start, previous.end)).toBe("Oct 22 – Oct 28");
  });

  it("boundary instants belong to exactly one period", () => {
    const { current } = comparisonPeriods(NOW);
    const r = [{ ts: current.start, statusId: "1", author: "a", topics: ["chatgpt"] }];
    const m = computePanelMetrics(r, ["chatgpt"], NOW, null);
    expect(m.currentTotal + m.previousTotal).toBe(1);
    expect(m.currentTotal).toBe(1);
  });

  it("marks time before installation and paused time as partial", () => {
    const installed = addLocalDays(NOW, -2);
    const m = computePanelMetrics([], ["chatgpt"], NOW, installed);
    expect(m.current.partial).toBe(true);
    expect(m.previous.partial).toBe(true);
    const paused = computePanelMetrics([], ["chatgpt"], NOW, addLocalDays(NOW, -20), [
      { from: addLocalDays(NOW, -3), to: addLocalDays(NOW, -2) },
    ]);
    expect(paused.current).toMatchObject({ partial: true, pausedDuring: true });
    expect(paused.previous.partial).toBe(false);
  });
});

describe("change", () => {
  it("shows no comparison for an empty denominator", () => {
    expect(change(share(3, 30), share(0, 0))).toEqual({ status: "none", pp: null, direction: null });
    expect(change(share(0, 0), share(2, 40)).status).toBe("none");
  });

  it("suppresses direction below 20 recorded exposures in either period, keeping counts", () => {
    const c = change(share(5, 19), share(1, 50));
    expect(c.status).toBe("insufficient");
    expect(c.direction).toBeNull();
    const m = computePanelMetrics([...rows(19, 5, -1), ...rows(50, 1, -8, "chatgpt", 500)], ["chatgpt"], NOW, 0);
    const s = interpretTopic(m.topics[0]!, "mentioned ChatGPT");
    expect(s).toContain("5 of 19");
    expect(s).toContain("1 of 50");
    expect(s).not.toMatch(/\bup\b|\bdown\b/);
  });

  it("describes tiny changes as about the same", () => {
    expect(change(share(10, 100), share(10, 101)).direction).toBe("flat");
  });
});

describe("repeated sources", () => {
  it("uses the two most frequent known authors and counts distinct authors", () => {
    const r = repeatedSources([
      { ts: 1, statusId: "1", author: "a", topics: [] },
      { ts: 2, statusId: "2", author: "a", topics: [] },
      { ts: 3, statusId: "3", author: "b", topics: [] },
      { ts: 4, statusId: "4", author: "c", topics: [] },
    ]);
    expect(r.topTwoExposures).toBe(3);
    expect(r.pct).toBe(75);
    expect(r.distinctKnownAuthors).toBe(3);
    expect(r.fullCoverage).toBe(true);
  });

  it("discloses coverage when authors are missing", () => {
    const r = repeatedSources([
      { ts: 1, statusId: "1", author: "a", topics: [] },
      { ts: 2, statusId: "2", author: null, topics: [] },
    ]);
    expect(r.fullCoverage).toBe(false);
    expect(r.knownAuthorExposures).toBe(1);
    expect(r.topicExposures).toBe(2);
  });
});

describe("unknown topics", () => {
  it("count in the denominator and are explained", () => {
    const m = computePanelMetrics(rows(40, 10, -1), ["chatgpt"], NOW, 0);
    expect(m.currentTotal).toBe(40);
    expect(m.unmatchedCurrent).toBe(30);
    expect(m.topics[0]!.current.total).toBe(40);
    expect(interpretUnknown(m)).toContain("30 of 40 recorded posts (75%)");
  });

  it("cold start has an empty denominator", () => {
    const m = computePanelMetrics([], ["chatgpt"], NOW, null);
    expect(m.topics[0]!.change.status).toBe("none");
    expect(interpretTopic(m.topics[0]!, "mentioned ChatGPT")).toMatch(/No eligible English text posts/);
  });
});
