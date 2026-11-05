import { CATALOG_VERSION, TOPICS, type TopicDefinition } from "./catalog";

export interface TopicMatch {
  topicId: string;
  label: string;
  /** Terms found in the text, in the order they appear in the catalog. */
  matchedTerms: string[];
}

export interface Classification {
  catalogVersion: string;
  /** Sorted by catalog priority; the first entry is the default topic. */
  matches: TopicMatch[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scripts written without spaces between words (or, for Hangul, with particles
 * glued to words). Terms in these scripts match as substrings.
 */
const NO_BOUNDARY_SCRIPTS = ["Han", "Hiragana", "Katakana", "Hangul", "Thai", "Lao", "Khmer", "Myanmar", "Tibetan"];
const SPACED_SCRIPTS = ["Latin", "Cyrillic", "Greek", "Arabic", "Hebrew", "Devanagari", "Bengali", "Tamil", "Telugu", "Gujarati", "Gurmukhi", "Georgian", "Armenian"];

/**
 * The "word character" class used for a boundary next to `ch`, or null for no
 * boundary. A Latin term only needs Latin letters/digits around it, so "AI" in
 * "AIで稼ぐ" or "ChatGPT" in "ChatGPTで" still match.
 */
function boundaryClass(ch: string): string | null {
  if (/[\p{N}]/u.test(ch)) return "[\\p{Script=Latin}\\p{N}_]";
  if (!/[\p{L}_]/u.test(ch)) return null;
  for (const s of NO_BOUNDARY_SCRIPTS) if (new RegExp(`\\p{Script=${s}}`, "u").test(ch)) return null;
  for (const s of SPACED_SCRIPTS) {
    if (new RegExp(`\\p{Script=${s}}`, "u").test(ch)) return `[\\p{Script=${s}}\\p{M}\\p{N}_]`;
  }
  return "[\\p{L}\\p{M}\\p{N}_]";
}

/** Plain catalog term → case-insensitive regex with script-aware word boundaries. */
export function termRegex(term: string, flags = "iu"): RegExp {
  const wildcard = term.endsWith("*");
  const core = (wildcard ? term.slice(0, -1) : term).normalize("NFKC");
  // "ai generated" also matches "AI-generated" / "ai_generated".
  let body = core.split(/\s+/).map(escapeRegex).join("[\\s\\-_]+");
  const first = [...core][0] ?? "";
  const last = [...core].at(-1) ?? "";
  const startClass = boundaryClass(first);
  const endClass = boundaryClass(last);
  if (wildcard) body += endClass ? `${endClass}*` : "";
  const start = startClass ? `(?<!${startClass})` : "";
  const end = wildcard || !endClass ? "" : `(?!${endClass})`;
  return new RegExp(`${start}${body}${end}`, flags);
}

const regexCache = new Map<string, RegExp>();
function cached(term: string): RegExp {
  let re = regexCache.get(term);
  if (!re) {
    re = termRegex(term);
    regexCache.set(term, re);
  }
  return re;
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function removeExclusions(text: string, exclusions: string[]): string {
  // Longest first so "claude monet" is removed before "monet".
  const sorted = [...exclusions].sort((a, b) => b.length - a.length);
  let out = text;
  for (const ex of sorted) {
    out = out.replace(termRegex(ex, "giu"), " ");
  }
  return out;
}

function found(text: string, terms: string[] | undefined): string[] {
  if (!terms) return [];
  return terms.filter((t) => cached(t).test(text));
}

function foundPatterns(text: string, patterns: string[] | undefined): string[] {
  if (!patterns) return [];
  const out: string[] = [];
  for (const p of patterns) {
    const m = new RegExp(p, "iu").exec(text);
    if (m) out.push(m[0].trim());
  }
  return out;
}

export function matchTopic(topic: TopicDefinition, rawText: string): TopicMatch | null {
  const text = removeExclusions(normalizeText(rawText), topic.exclusions);
  if (topic.kind === "tool") {
    const strong = found(text, topic.strongAliases);
    if (strong.length > 0) {
      return { topicId: topic.id, label: topic.label, matchedTerms: strong };
    }
    const weak = found(text, topic.weakAliases);
    if (weak.length > 0) {
      const ctx = found(text, topic.contextTerms);
      if (ctx.length > 0) {
        return { topicId: topic.id, label: topic.label, matchedTerms: [...weak, ...ctx.map((c) => `${c} (context)`)] };
      }
    }
    return null;
  }
  // Claim: every evidence group must be satisfied.
  const evidence: string[] = [];
  for (const group of topic.requireAll ?? []) {
    const hits = [...found(text, group.terms), ...foundPatterns(text, group.patterns)];
    for (const pair of group.pairs ?? []) {
      const a = [...found(text, pair.a), ...foundPatterns(text, pair.aPatterns)];
      const b = found(text, pair.b);
      if (a.length > 0 && b.length > 0) hits.push(`${a[0]} + ${b[0]}`);
    }
    if (hits.length === 0) return null;
    evidence.push(...hits.map((h) => `${h} (${group.name.toLowerCase()})`));
  }
  return { topicId: topic.id, label: topic.label, matchedTerms: evidence };
}

export function classify(text: string): Classification {
  const matches: TopicMatch[] = [];
  const ordered = [...TOPICS].sort((a, b) => a.priority - b.priority || TOPICS.indexOf(a) - TOPICS.indexOf(b));
  for (const topic of ordered) {
    const m = matchTopic(topic, text);
    if (m) matches.push(m);
  }
  return { catalogVersion: CATALOG_VERSION, matches };
}
