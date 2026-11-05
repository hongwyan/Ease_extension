/**
 * Post language comes from X's own detector: the `lang` attribute X puts on
 * every post's text element. We group by the primary subtag ("pt-BR" → "pt").
 */

export const UNDETERMINED = "und";

/** X's pseudo-codes for text without a natural language (emoji, hashtags, mentions, cashtags, links…). */
const PSEUDO = new Set(["und", "zxx", "qme", "qht", "qam", "qct", "qst", "art", "mul"]);

/** Deprecated codes X still emits. */
const ALIASES: Record<string, string> = { in: "id", iw: "he", ji: "yi", jw: "jv" };

/** "EN" → "en", "pt-BR" → "pt", "qme" / missing / malformed → "und". */
export function normalizeLang(raw: string | null | undefined): string {
  if (!raw) return UNDETERMINED;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (!/^[a-z]{2,3}$/.test(primary) || PSEUDO.has(primary)) return UNDETERMINED;
  return ALIASES[primary] ?? primary;
}

export function isLangCode(x: unknown): x is string {
  return typeof x === "string" && /^[a-z]{2,3}$/.test(x);
}

let names: Intl.DisplayNames | null = null;

/** English display name: "ja" → "Japanese", "und" → "Undetermined language". */
export function languageName(code: string): string {
  if (code === UNDETERMINED) return "Undetermined language";
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });
    const n = names.of(code);
    if (n && n !== code) return n;
  } catch {
    /* fall through */
  }
  return code.toUpperCase();
}
