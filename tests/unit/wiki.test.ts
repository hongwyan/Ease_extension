import { describe, expect, it } from "vitest";
import { wikiItems } from "../fixtures/wikiData";
import {
  ValidationError,
  buildUrl,
  computeTrend,
  parseResponse,
  queryRange,
} from "../../src/shared/wiki";

const NOW = Date.parse("2026-11-04T14:00:00Z");
const RANGE = queryRange(NOW);

describe("query", () => {
  it("covers 21 complete UTC days ending yesterday", () => {
    expect(RANGE).toEqual({ start: "2026-10-14", end: "2026-11-03" });
  });

  it("sends only the catalog article and the date range", () => {
    expect(buildUrl("Claude_(AI)", RANGE)).toBe(
      "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/Claude_(AI)/daily/2026101400/2026110300",
    );
    expect(() => buildUrl("x/../../evil?q=1", RANGE)).toThrow();
  });
});

describe("validation", () => {
  it("parses valid data", () => {
    const days = parseResponse(wikiItems("ChatGPT", RANGE.start, RANGE.end, () => 10), "ChatGPT", RANGE);
    expect(days.size).toBe(21);
  });

  it.each([
    ["no items", {}],
    ["wrong article", wikiItems("Other", "2026-11-01", "2026-11-01", () => 1)],
    ["impossible date", { items: [{ project: "en.wikipedia", article: "ChatGPT", granularity: "daily", timestamp: "2026023100", views: 1 }] }],
    ["outside range", wikiItems("ChatGPT", "2026-11-04", "2026-11-04", () => 1)],
    ["negative views", wikiItems("ChatGPT", "2026-11-01", "2026-11-01", () => -1)],
    ["duplicate day", { items: [...wikiItems("ChatGPT", "2026-11-01", "2026-11-01", () => 1).items, ...wikiItems("ChatGPT", "2026-11-01", "2026-11-01", () => 2).items] }],
  ])("rejects %s", (_name, json) => {
    expect(() => parseResponse(json, "ChatGPT", RANGE)).toThrow(ValidationError);
  });
});

describe("trend", () => {
  it("uses the latest two complete seven-day periods", () => {
    const days = parseResponse(
      wikiItems("ChatGPT", RANGE.start, RANGE.end, (d) => (d >= "2026-10-28" ? 200 : 100)),
      "ChatGPT",
      RANGE,
    );
    const t = computeTrend(days, "ChatGPT", RANGE)!;
    expect(t.current).toEqual({ start: "2026-10-28", end: "2026-11-03", total: 1400, missingDays: 0 });
    expect(t.previous).toEqual({ start: "2026-10-21", end: "2026-10-27", total: 700, missingDays: 0 });
    expect(t.direction).toBe("up");
    expect(t.pctChange).toBe(100);
    expect(t.delayed).toBe(false);
    expect(t.articleUrl).toBe("https://en.wikipedia.org/wiki/ChatGPT");
  });

  it("slides back past a missing day to a complete pair", () => {
    const days = parseResponse(
      wikiItems("ChatGPT", RANGE.start, RANGE.end, (d) => (d === "2026-11-02" ? null : 50)),
      "ChatGPT",
      RANGE,
    );
    const t = computeTrend(days, "ChatGPT", RANGE)!;
    expect(t.latestDay).toBe("2026-11-01");
    expect(t.incomplete).toBe(false);
    expect(t.direction).toBe("flat");
  });

  it("reports missing days and suppresses direction when no complete pair exists", () => {
    const days = parseResponse(
      wikiItems("ChatGPT", RANGE.start, RANGE.end, (_d, i) => (i % 5 === 0 ? null : 50)),
      "ChatGPT",
      RANGE,
    );
    const t = computeTrend(days, "ChatGPT", RANGE)!;
    expect(t.incomplete).toBe(true);
    expect(t.direction).toBeNull();
    expect(t.current.missingDays + t.previous.missingDays).toBeGreaterThan(0);
  });

  it("handles a zero baseline", () => {
    const days = parseResponse(
      wikiItems("ChatGPT", RANGE.start, RANGE.end, (d) => (d >= "2026-10-28" ? 5 : 0)),
      "ChatGPT",
      RANGE,
    );
    const t = computeTrend(days, "ChatGPT", RANGE)!;
    expect(t.direction).toBe("up-from-zero");
    expect(t.pctChange).toBeNull();
  });

  it("flags delayed data", () => {
    const days = parseResponse(wikiItems("ChatGPT", RANGE.start, "2026-10-30", () => 9), "ChatGPT", RANGE);
    const t = computeTrend(days, "ChatGPT", RANGE)!;
    expect(t.latestDay).toBe("2026-10-30");
    expect(t.delayed).toBe(true);
  });

  it("returns null when there is no data", () => {
    expect(computeTrend(new Map(), "ChatGPT", RANGE)).toBeNull();
  });
});
