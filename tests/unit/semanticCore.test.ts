import { describe, expect, it } from "vitest";
import { aggregate, contentUnits, cosine, isAssessable, l2normalize, meanPool, planChunks, preprocess, sha256Hex, splitSentences } from "../../src/semantic/core";
import { RELATED_THRESHOLDS, RELEASE_ENCODER, encoderKey, isRelated, thresholdFor } from "../../src/semantic/model";
import { decodeVec, encodeVec } from "../../src/semantic/protocol";
import { rowInput } from "../../src/background/semantic";
import { labeledPairs, FAMILIES } from "../semantic/fixture";

describe("preprocessing", () => {
  it("normalizes width, removes links and collapses whitespace", () => {
    expect(preprocess("ＡＩ  is\n\nhere https://t.co/abc123 ok")).toBe("AI is here ok");
    expect(preprocess("see example.com/x and www.foo.io/bar")).toBe("see and");
    expect(preprocess("zero​width")).toBe("zerowidth");
  });

  it("content units: CJK characters and spaced words; emoji, links and bare handles do not count", () => {
    expect(contentUnits("房租又涨了")).toBe(5);
    expect(contentUnits("Rent went up")).toBe(3);
    expect(contentUnits("🔥🔥🔥")).toBe(0);
    expect(isAssessable(preprocess("🔥🔥🔥 https://t.co/x"))).toBe(false);
    expect(isAssessable(preprocess("ok"))).toBe(false);
    expect(isAssessable("Single again.")).toBe(true);
    expect(isAssessable("科目三过了")).toBe(true);
  });

  it("splits Latin and CJK sentences", () => {
    expect(splitSentences("One. Two! 三。四？")).toEqual(["One.", "Two!", "三。", "四？"]);
  });
});

describe("chunking policy", () => {
  // 1 token per character + 2 special tokens: easy to reason about.
  const count = (s: string) => [...s].length + 2;
  it("keeps short text as one chunk", () => {
    expect(planChunks("short text", count, 96, 8)).toEqual({ chunks: ["short text"], truncated: false, tokens: [12] });
  });
  it("packs whole sentences within the token budget and reports truncation", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const plan = planChunks(text, count, 64, 3);
    expect(plan.chunks).toHaveLength(3);
    expect(plan.tokens.every((t) => t <= 64)).toBe(true);
    expect(plan.truncated).toBe(true);
    expect(plan.chunks[0]).toBe("Sentence number 0 is here. Sentence number 1 is here.");
  });
  it("hard-splits a single over-long sentence", () => {
    const plan = planChunks("x".repeat(250), count, 100, 8);
    expect(plan.chunks.map((c) => c.length)).toEqual([98, 98, 54]);
    expect(plan.truncated).toBe(false);
  });
});

describe("vectors", () => {
  it("mean pooling respects the attention mask; aggregation is a unit mean", () => {
    const data = new Float32Array([1, 0, 3, 0, 9, 9, 0, 2, 0, 4, 0, 0]); // batch 2, seq 3, dim 2
    const pooled = meanPool(data, [2, 3, 2], [1, 1, 0, 1, 1, 0]);
    expect([...pooled[0]!]).toEqual([2, 0]);
    expect([...pooled[1]!]).toEqual([0, 3]);
    const agg = aggregate([l2normalize(new Float32Array([1, 0])), l2normalize(new Float32Array([0, 1]))]);
    expect(cosine(agg, agg)).toBeCloseTo(1, 6);
    expect(agg[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });
  it("wire encoding round-trips exactly", () => {
    const v = new Float32Array([0.1, -2.5, 3e-8, 1]);
    expect(decodeVec(encodeVec(v))).toEqual(v);
  });
  it("cache keys depend on the encoder identity and the exact input", async () => {
    expect(encoderKey()).toContain(RELEASE_ENCODER.revision.slice(0, 12));
    expect(encoderKey()).toContain(`${RELEASE_ENCODER.maxTokens}x${RELEASE_ENCODER.maxChunks}`);
    expect(encoderKey({ ...RELEASE_ENCODER, revision: "f".repeat(40) })).not.toBe(encoderKey());
    expect(encoderKey({ ...RELEASE_ENCODER, maxTokens: 128 })).not.toBe(encoderKey());
    expect(await sha256Hex("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });
});

describe("relatedness cutoffs", () => {
  it("same-language cutoff only when both tags are known and equal", () => {
    expect(thresholdFor("en", "en")).toBe(RELATED_THRESHOLDS.sameLanguage);
    expect(thresholdFor("en", "zh")).toBe(RELATED_THRESHOLDS.crossLanguage);
    expect(thresholdFor("und", "und")).toBe(RELATED_THRESHOLDS.crossLanguage);
    expect(RELATED_THRESHOLDS.crossLanguage).toBeLessThanOrEqual(RELATED_THRESHOLDS.sameLanguage);
    expect(isRelated(0.6, "en", "zh")).toBe(true);
    expect(isRelated(0.6, "en", "en")).toBe(false);
  });
});

describe("legacy rows", () => {
  it("stored text wins; otherwise the excerpt (without its ellipsis) is used and flagged", () => {
    expect(rowInput({ text: "Full visible text", excerpt: "Full…" })).toEqual({ input: "Full visible text", fromExcerpt: false });
    expect(rowInput({ excerpt: "Rent went up again and…" })).toEqual({ input: "Rent went up again and", fromExcerpt: true });
    expect(rowInput({ excerpt: "" })).toEqual({ input: "", fromExcerpt: true });
  });
});

describe("evaluation fixture", () => {
  const pairs = labeledPairs();
  it("has ≥120 labeled pairs, Chinese, English and cross-language, in two disjoint splits", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(120);
    const langs = new Set(pairs.map((p) => [p.a.lang, p.b.lang].sort().join("-")));
    expect([...langs].sort()).toEqual(["en-en", "en-zh", "zh-zh"]);
    for (const split of ["calibration", "heldout"] as const) {
      const ps = pairs.filter((p) => p.split === split);
      expect(ps.filter((p) => p.label === "related").length).toBeGreaterThan(50);
      expect(ps.filter((p) => p.label === "unrelated").length).toBeGreaterThan(50);
      expect(ps.some((p) => p.label === "ambiguous")).toBe(true);
    }
  });
  it("covers ≥ 8 non-catalog topic families including the required ones", () => {
    const ids = FAMILIES.map((f) => f.id);
    for (const required of ["housing", "exams", "careers", "fitness", "travel", "relationships", "software", "investing"]) {
      expect(ids).toContain(required);
    }
  });
  it("includes every required kind of hard case", () => {
    const kinds = pairs.map((p) => p.kind).join(" ");
    for (const k of ["shared-word", "ambiguous-name", "same-tool-different-use", "negation", "satire", "short", "long", "cross-language-translation"]) {
      expect(kinds).toContain(k);
    }
  });
});
