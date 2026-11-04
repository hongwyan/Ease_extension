import { describe, expect, it } from "vitest";
import { EXCERPT_CHARS, makeExcerpt, validateMessage } from "../../src/shared/messages";

const good = {
  type: "exposure",
  sessionId: "11111111-1111-4111-8111-111111111111",
  statusId: "1854000000000000001",
  author: "alice_1",
  text: "hello",
  epoch: 0,
};

describe("validateMessage", () => {
  it("accepts a well-formed exposure and strips extra fields", () => {
    expect(validateMessage({ ...good, extra: "x" })).toEqual(good);
  });

  it.each([
    ["bad session", { ...good, sessionId: "nope" }],
    ["bad status id", { ...good, statusId: "12a" }],
    ["bad handle", { ...good, author: "has space" }],
    ["empty text", { ...good, text: "  " }],
    ["huge text", { ...good, text: "x".repeat(5000) }],
    ["bad epoch", { ...good, epoch: -1 }],
    ["unknown type", { type: "drop-tables" }],
    ["not an object", "exposure"],
  ])("rejects %s", (_n, m) => expect(validateMessage(m)).toBeNull());

  it("accepts a null author", () => expect(validateMessage({ ...good, author: null })).not.toBeNull());

  it("only accepts catalog topic IDs for panel and trend requests", () => {
    expect(validateMessage({ type: "panel", topicIds: ["chatgpt", "chatgpt"] })).toEqual({ type: "panel", topicIds: ["chatgpt"] });
    expect(validateMessage({ type: "panel", topicIds: ["evil"] })).toBeNull();
    expect(validateMessage({ type: "trend", topicId: "claude-ai" })).toEqual({ type: "trend", topicId: "claude-ai" });
    expect(validateMessage({ type: "trend", topicId: "../x" })).toBeNull();
  });

  it("validates settings changes", () => {
    expect(validateMessage({ type: "setSettings", recording: true })).toEqual({ type: "setSettings", recording: true });
    expect(validateMessage({ type: "setSettings", recording: "yes" })).toBeNull();
  });
});

describe("makeExcerpt", () => {
  it("keeps a short excerpt only", () => {
    const e = makeExcerpt("word ".repeat(100));
    expect(e.length).toBeLessThanOrEqual(EXCERPT_CHARS + 1);
    expect(e.endsWith("…")).toBe(true);
    expect(makeExcerpt("  short   text ")).toBe("short text");
  });
});
