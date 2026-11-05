import { describe, expect, it } from "vitest";
import { CATALOG_VERSION, TOPICS } from "../../src/shared/catalog";
import { classify, matchTopic, termRegex } from "../../src/shared/classify";

const ids = (text: string) => classify(text).matches.map((m) => m.topicId);

describe("catalog examples (editable in src/shared/catalog.ts)", () => {
  for (const topic of TOPICS) {
    for (const text of topic.examples.match) {
      it(`${topic.id} matches: ${text}`, () => expect(matchTopic(topic, text)).not.toBeNull());
    }
    for (const text of topic.examples.noMatch) {
      it(`${topic.id} does not match: ${text}`, () => expect(matchTopic(topic, text)).toBeNull());
    }
  }
});

describe("spec requirements", () => {
  it("supports the three required topics", () => {
    expect(TOPICS.map((t) => t.label)).toEqual(["ChatGPT", "Claude AI", "Earning money with AI"]);
    expect(CATALOG_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/);
  });

  it("“I used AI to organize my notes” is not an earnings claim", () => {
    expect(ids("I used AI to organize my notes")).toEqual([]);
  });

  it("“I sold an AI-generated logo to a client for $80” is an earnings claim", () => {
    expect(ids("I sold an AI-generated logo to a client for $80")).toEqual(["ai-earnings"]);
  });

  it("“Claude Monet” is not Claude AI", () => {
    expect(ids("Claude Monet painted water lilies with AI-level precision")).not.toContain("claude-ai");
    expect(ids("Claude Monet")).toEqual([]);
  });

  it("a post can match a tool and the claim; default is deterministic (catalog priority)", () => {
    const c = classify("How I made $12,000 last month selling ChatGPT prompt packs");
    expect(c.matches.map((m) => m.topicId)).toEqual(["chatgpt", "ai-earnings"]);
    for (let i = 0; i < 5; i++) expect(classify("Claude Code and ChatGPT helped me earn $500").matches[0]!.topicId).toBe("chatgpt");
  });

  it("earnings needs AI evidence and income evidence together", () => {
    expect(ids("I earned $5,000 freelancing this month")).toEqual([]); // income, no AI
    expect(ids("AI wrote my grocery list")).toEqual([]); // AI, no income
    expect(ids("AI side hustle ideas that actually pay")).toEqual(["ai-earnings"]);
  });

  it("reports matched terms for the explanation panel", () => {
    const m = classify("I sold an AI-generated logo to a client for $80").matches[0]!;
    expect(m.matchedTerms.join(" ")).toMatch(/ai \(ai evidence\)/);
    expect(m.matchedTerms.join(" ")).toMatch(/\$80 \+ sold \(income evidence\)/);
  });

  it("whole-word matching: “ai” never matches inside words", () => {
    expect(termRegex("ai").test("I said hello at the fair")).toBe(false);
    expect(termRegex("ai").test("AI's impact")).toBe(true);
    expect(termRegex("chatgpt").test("#ChatGPT")).toBe(true);
    expect(termRegex("ai generated").test("AI-generated")).toBe(true);
  });

  it("script-aware boundaries: Latin names next to CJK text, CJK terms as substrings", () => {
    expect(termRegex("chatgpt").test("ChatGPTで稼いだ")).toBe(true);
    expect(termRegex("ai").test("生成AIで")).toBe(true);
    expect(termRegex("ai").test("Kaiの日記")).toBe(false);
    expect(termRegex("稼").test("月30万円稼いだ")).toBe(true);
    expect(termRegex("ии").test("Это сделал ИИ.")).toBe(true);
    expect(termRegex("ии").test("линии")).toBe(false);
  });

  it("every topic lists the languages it has vocabulary for", () => {
    expect(TOPICS.find((t) => t.id === "ai-earnings")!.vocabularyLanguages).toEqual(
      expect.arrayContaining(["es", "pt", "fr", "de", "ja", "ko", "zh", "ru", "hi", "ar"]),
    );
  });

  it("handles curly apostrophes and Unicode names", () => {
    expect(ids("Anthropic’s Claude is great at long documents")).toContain("claude-ai");
    expect(ids("Claude Makélélé and an AI model of midfield play")).toEqual([]);
  });
});
