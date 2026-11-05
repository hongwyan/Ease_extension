import { describe, expect, it } from "vitest";
import { languageName, normalizeLang } from "../../src/shared/language";

describe("language", () => {
  it.each([
    ["en", "en"],
    ["EN-gb", "en"],
    ["pt-BR", "pt"],
    ["zh-Hant", "zh"],
    ["in", "id"],
    ["iw", "he"],
    ["qme", "und"],
    ["zxx", "und"],
    ["und", "und"],
    ["", "und"],
    [null, "und"],
    ["x<script>", "und"],
  ])("normalizes %s to %s", (raw, out) => expect(normalizeLang(raw)).toBe(out));

  it("names languages in English", () => {
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("pt")).toBe("Portuguese");
    expect(languageName("und")).toBe("Undetermined language");
  });
});
