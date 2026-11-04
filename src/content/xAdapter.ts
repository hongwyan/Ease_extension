/**
 * X (x.com) DOM adapter. EVERY X-specific selector and extraction rule lives
 * in this file; when X changes its markup, update SELECTORS and the functions
 * below, then run `npm run test:unit` (tests/unit/xAdapter.test.ts) and
 * `npm run test:e2e`.
 */

export const SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  /** The Home timeline region inside the primary column. */
  timeline: '[aria-label^="Timeline:"]',
  tablist: '[role="tablist"]',
  tab: '[role="tab"]',
  post: 'article[data-testid="tweet"]',
  postText: '[data-testid="tweetText"]',
  /** Reply / repost / like / views / share row. */
  actionBar: '[role="group"]',
  /** Promoted-post tracking wrapper. */
  adMarker: '[data-testid="placementTracking"]',
  /** Areas that are never part of the main timeline. */
  outside: '[data-testid="sidebarColumn"], aside, [role="complementary"], [aria-modal="true"]',
} as const;

export const FOR_YOU_LABEL = "For you";
export const FOLLOWING_LABEL = "Following";
const AD_LABELS = new Set(["Ad", "Promoted"]);
const PERMALINK = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:[/?#]|$)/;

export type FeedContext = "for-you" | "following" | "other" | "unknown";

export interface ContextInfo {
  context: FeedContext;
  reason: string;
}

/**
 * Identifies the active feed from page state, not the URL alone:
 * /home is shared by For you and Following, so the selected tab decides.
 */
export function detectContext(doc: Document = document): ContextInfo {
  const lang = (doc.documentElement.getAttribute("lang") ?? "").toLowerCase();
  if (!lang.startsWith("en")) return { context: "unknown", reason: "X interface is not in English" };
  const path = doc.location?.pathname ?? "";
  if (path !== "/home") return { context: "other", reason: `Route ${path} is not the Home timeline` };
  const column = doc.querySelector(SELECTORS.primaryColumn);
  if (!column) return { context: "unknown", reason: "Primary column not found" };
  const tablist = column.querySelector(SELECTORS.tablist);
  if (!tablist) return { context: "unknown", reason: "Home tabs not found" };
  const selected = tablist.querySelector(`${SELECTORS.tab}[aria-selected="true"]`);
  if (!selected) return { context: "unknown", reason: "No selected Home tab" };
  const label = (selected.textContent ?? "").trim();
  if (label === FOR_YOU_LABEL) return { context: "for-you", reason: "For you tab selected" };
  if (label === FOLLOWING_LABEL) return { context: "following", reason: "Following tab selected" };
  return { context: "other", reason: `Tab “${label}” selected` };
}

/** Outer posts in the main Home timeline (not sidebars, modals or nested quote cards). */
export function timelinePosts(doc: Document = document): HTMLElement[] {
  const column = doc.querySelector(SELECTORS.primaryColumn);
  if (!column) return [];
  const timeline = column.querySelector(SELECTORS.timeline);
  if (!timeline) return [];
  return [...timeline.querySelectorAll<HTMLElement>(SELECTORS.post)].filter(
    (a) => !a.parentElement?.closest(SELECTORS.post) && !a.closest(SELECTORS.outside),
  );
}

/**
 * True when `el` belongs to quoted / embedded material inside `post` rather
 * than to the outer post itself. X renders quoted posts as a nested
 * non-anchor role="link" card (or occasionally a nested article). Ordinary
 * anchors also carry role="link" on X, so <a> elements never count.
 */
export function isInQuotedMaterial(el: Element, post: Element): boolean {
  for (let n: Element | null = el.parentElement; n && n !== post; n = n.parentElement) {
    if (n.tagName === "ARTICLE") return true;
    if (n.tagName !== "A" && n.getAttribute("role") === "link") return true;
  }
  return false;
}

export interface Permalink {
  author: string;
  statusId: string;
}

export function parsePermalink(href: string): Permalink | null {
  let path = href;
  try {
    const u = new URL(href, "https://x.com");
    if (u.hostname !== "x.com" && u.hostname !== "twitter.com") return null;
    path = u.pathname;
  } catch {
    return null;
  }
  const m = PERMALINK.exec(path);
  if (!m) return null;
  const author = m[1]!;
  if (author.toLowerCase() === "i") return null;
  return { author, statusId: m[2]! };
}

/** The outer post's own permalink: the status link wrapping its own timestamp. */
export function outerPermalink(post: Element): Permalink | null {
  for (const time of post.querySelectorAll("time")) {
    if (isInQuotedMaterial(time, post)) continue;
    const a = time.closest("a[href]");
    if (!a || !post.contains(a)) continue;
    const p = parsePermalink(a.getAttribute("href") ?? "");
    if (p) return p;
  }
  return null;
}

export function isAd(post: Element): boolean {
  if (post.querySelector(SELECTORS.adMarker) || post.closest(SELECTORS.adMarker)) return true;
  for (const span of post.querySelectorAll("span")) {
    if (span.closest(SELECTORS.postText)) continue;
    if (span.children.length === 0 && AD_LABELS.has((span.textContent ?? "").trim())) return true;
  }
  return false;
}

function visibleText(el: HTMLElement): string {
  // innerText respects CSS visibility (visible text only); textContent is the jsdom fallback.
  const t = typeof el.innerText === "string" && el.innerText.length > 0 ? el.innerText : (el.textContent ?? "");
  return t.replace(/\s+/g, " ").trim();
}

export type Ineligible =
  | "ad"
  | "no-permalink"
  | "media-only"
  | "not-english"
  | "language-unknown";

export interface PostInfo {
  statusId: string | null;
  author: string | null;
  text: string;
  lang: string | null;
  hasQuote: boolean;
  eligible: boolean;
  ineligibleReason: Ineligible | null;
}

/**
 * Language: X annotates post text with a `lang` attribute (its own detector).
 * Only lang="en" (or en-*) is eligible; "und", "qme" (emoji), "zxx" etc. and
 * missing attributes are excluded.
 */
export function extractPost(post: HTMLElement): PostInfo {
  const link = outerPermalink(post);
  const textEl = [...post.querySelectorAll<HTMLElement>(SELECTORS.postText)].find(
    (el) => !isInQuotedMaterial(el, post),
  );
  const text = textEl ? visibleText(textEl) : "";
  const lang = textEl?.getAttribute("lang")?.toLowerCase() ?? null;
  const hasQuote = [...post.querySelectorAll(SELECTORS.postText)].some((el) => isInQuotedMaterial(el, post));
  let reason: Ineligible | null = null;
  if (isAd(post)) reason = "ad";
  else if (!link) reason = "no-permalink";
  else if (!text) reason = "media-only";
  else if (!lang) reason = "language-unknown";
  else if (lang !== "en" && !lang.startsWith("en-")) reason = "not-english";
  return {
    statusId: link?.statusId ?? null,
    author: link?.author ?? null,
    text,
    lang,
    hasQuote,
    eligible: reason === null,
    ineligibleReason: reason,
  };
}

/** Where the Feed context button goes: after the outer post's action bar. */
export function buttonAnchor(post: HTMLElement): { parent: Element; after: Element | null } | null {
  const bar = [...post.querySelectorAll(SELECTORS.actionBar)].find((g) => !isInQuotedMaterial(g, post));
  if (bar?.parentElement) return { parent: bar.parentElement, after: bar };
  const textEl = [...post.querySelectorAll(SELECTORS.postText)].find((el) => !isInQuotedMaterial(el, post));
  if (textEl?.parentElement) return { parent: textEl.parentElement, after: textEl };
  return null;
}

/** "light" or "dark", from X's page background (Default vs Dim / Lights out). */
export function detectTheme(doc: Document = document): "light" | "dark" {
  const bg = doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? "";
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  if (!m) return "light";
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 128 ? "dark" : "light";
}
