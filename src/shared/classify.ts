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

const WORD = "[\\p{L}\\p{N}_]";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plain catalog term → whole-word, case-insensitive regex. */
export function termRegex(term: string, flags = "iu"): RegExp {
  let body: string;
  const wildcard = term.endsWith("*");
  const core = wildcard ? term.slice(0, -1) : term;
  body = core
    .split(/\s+/)
    .map(escapeRegex)
    .join("[\\s\\-_]+");
  // "ai generated" should also match "AI-generated"; handled by the joiner above.
  if (wildcard) body += `${WORD}*`;
  const start = /^[\p{L}\p{N}_]/u.test(core) ? `(?<!${WORD})` : "";
  const end = wildcard || !/[\p{L}\p{N}_]$/u.test(core) ? "" : `(?!${WORD})`;
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
