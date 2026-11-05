import { describe, expect, it } from "vitest";
import { EXCERPT_CHARS, makeExcerpt, validateMessage } from "../../src/shared/messages";

const good = {
  type: "exposure",
  sessionId: "11111111-1111-4111-8111-111111111111",
  statusId: "1854000000000000001",
  author: "alice_1",
  text: "hello",
  lang: "ja",
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
    ["missing language", { ...good, lang: undefined }],
    ["malformed language", { ...good, lang: "ja-JP; drop" }],
    ["unknown type", { type: "drop-tables" }],
    ["not an object", "exposure"],
  ])("rejects %s", (_n, m) => expect(validateMessage(m)).toBeNull());

  it("accepts a null author", () => expect(validateMessage({ ...good, author: null })).not.toBeNull());

  it("only accepts catalog topic IDs for panel and trend requests", () => {
    expect(validateMessage({ type: "panel", topicIds: ["chatgpt", "chatgpt"], lang: "en" })).toEqual({
      type: "panel",
      topicIds: ["chatgpt"],
      lang: "en",
    });
    expect(validateMessage({ type: "panel", topicIds: ["evil"], lang: "en" })).toBeNull();
    expect(validateMessage({ type: "panel", topicIds: ["chatgpt"] })).toBeNull();
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

describe("semantic messages", () => {
  const ok = {
    type: "semantic",
    requestId: "0b9c3f0e-8a7d-4c1e-9b2a-1f2e3d4c5b6a",
    statusId: "1855000000000000001",
    text: "上海房租又涨了",
    lang: "zh",
    epoch: 2,
  };
  it("accepts a bounded request with a request ID, status ID, language and epoch", () => {
    expect(validateMessage(ok)).toEqual(ok);
    expect(validateMessage({ ...ok, extra: "dropped" })).toEqual(ok);
    expect(validateMessage({ ...ok, text: "" })).toEqual({ ...ok, text: "" }); // empty text → "insufficient text" state, not an error
  });
  it("rejects malformed or unbounded requests", () => {
    expect(validateMessage({ ...ok, requestId: "1" })).toBeNull();
    expect(validateMessage({ ...ok, statusId: "abc" })).toBeNull();
    expect(validateMessage({ ...ok, text: "x".repeat(4001) })).toBeNull();
    expect(validateMessage({ ...ok, lang: "Chinese" })).toBeNull();
    expect(validateMessage({ ...ok, epoch: -1 })).toBeNull();
    expect(validateMessage({ ...ok, epoch: "2" })).toBeNull();
  });
  it("validates cancellation", () => {
    expect(validateMessage({ type: "semanticCancel", requestId: ok.requestId, keepPartial: true })).toEqual({
      type: "semanticCancel",
      requestId: ok.requestId,
      keepPartial: true,
    });
    expect(validateMessage({ type: "semanticCancel", requestId: ok.requestId })).toBeNull();
  });
  it("catalog panel and trend requests keep their own strict validation", () => {
    expect(validateMessage({ type: "panel", topicIds: ["not-a-topic"], lang: "en" })).toBeNull();
    expect(validateMessage({ type: "trend", topicId: "semantic" })).toBeNull();
  });
});
