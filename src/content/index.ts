import { classify } from "../shared/classify";
import { MAX_TEXT, type ExposureResult, type PanelResponse, type TrendResponse } from "../shared/messages";
import { DEFAULT_SETTINGS, SETTINGS_KEY, getSettings, parseSettings, type Settings } from "../shared/settings";
import type { TrendResult } from "../shared/wiki";
import { ExposureTracker } from "./tracker";
import { FeedPanel } from "./ui/panel";
import { BUTTON_CSS } from "./ui/styles";
import { h, ISOLATED_EVENTS, isolateEvents } from "./ui/dom";
import {
  buttonAnchor,
  detectContext,
  detectTheme,
  extractPost,
  timelinePosts,
  type FeedContext,
} from "./xAdapter";

const BUTTON_TAG = "x-feed-lens-button";
const PANEL_TAG = "x-feed-lens-panel";

/** One session = this top-level document's lifetime, across in-page route changes. */
const sessionId = crypto.randomUUID();
let settings: Settings = DEFAULT_SETTINGS;
let context: FeedContext = "unknown";

async function send<T>(msg: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as T;
  } catch {
    return null; // Extension reloaded or service worker unavailable.
  }
}

const tracker = new ExposureTracker({
  canRecord: () => settings.recording,
  isForYou: () => detectContext().context === "for-you",
  epoch: () => settings.epoch,
  async send(info, epoch) {
    const r = await send<ExposureResult>({
      type: "exposure",
      sessionId,
      statusId: info.statusId,
      author: info.author,
      text: info.text.slice(0, MAX_TEXT),
      epoch,
    });
    if (r?.ok && (r.recorded || r.reason === "duplicate")) return "stored";
    return "retry";
  },
});

const panel = new FeedPanel();

function ensureButton(post: HTMLElement): void {
  const existing = [...post.querySelectorAll<HTMLElement>(BUTTON_TAG)];
  const info = extractPost(post);
  if (!info.eligible) {
    existing.forEach((e) => e.remove());
    return;
  }
  if (existing.length > 0) {
    existing.slice(1).forEach((e) => e.remove());
    return;
  }
  const anchor = buttonAnchor(post);
  if (!anchor) return;
  const host = document.createElement(BUTTON_TAG);
  host.setAttribute("data-theme", detectTheme());
  const root = host.attachShadow({ mode: "open" });
  const btn = h(
    "button",
    { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", title: "Show how often this topic appears in your feed" },
    lensIcon(),
    "Feed context",
  );
  root.append(h("style", {}, BUTTON_CSS), btn);
  // Never let the click reach X: no navigation to the post, no thread expansion, no shortcuts.
  isolateEvents(host, ISOLATED_EVENTS);
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    togglePanel(post, host, btn);
  });
  anchor.parent.insertBefore(host, anchor.after ? anchor.after.nextSibling : null);
}

function lensIcon(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const c = document.createElementNS(ns, "circle");
  c.setAttribute("cx", "10");
  c.setAttribute("cy", "10");
  c.setAttribute("r", "6.5");
  c.setAttribute("fill", "none");
  c.setAttribute("stroke", "currentColor");
  c.setAttribute("stroke-width", "2.2");
  const l = document.createElementNS(ns, "path");
  l.setAttribute("d", "M15 15l5.5 5.5");
  l.setAttribute("stroke", "currentColor");
  l.setAttribute("stroke-width", "2.2");
  l.setAttribute("stroke-linecap", "round");
  svg.append(c, l);
  return svg;
}

function togglePanel(post: HTMLElement, host: HTMLElement, btn: HTMLButtonElement): void {
  if (panel.isOpen() && panel.anchor === host) {
    panel.close(true);
    return;
  }
  const info = extractPost(post);
  if (!info.eligible || !info.statusId) return;
  const classification = classify(info.text);
  btn.setAttribute("aria-expanded", "true");
  panel.open({
    anchor: host,
    returnFocus: btn,
    post: info,
    classification,
    recording: settings.recording,
    theme: detectTheme(),
    requestMetrics: (topicIds) => send<PanelResponse>({ type: "panel", topicIds }),
    requestTrend: async (topicId): Promise<TrendResult | null> =>
      (await send<TrendResponse>({ type: "trend", topicId }))?.result ?? null,
    onClose: () => btn.setAttribute("aria-expanded", "false"),
  });
}

function removeButtons(): void {
  document.querySelectorAll(BUTTON_TAG).forEach((b) => b.remove());
}

function scan(): void {
  const next = detectContext().context;
  if (next !== context) {
    context = next;
    tracker.cancelAll();
    if (next !== "for-you") {
      panel.close(false);
      removeButtons();
    }
  }
  if (context !== "for-you") {
    tracker.sync([]);
    return;
  }
  const posts = timelinePosts();
  for (const p of posts) ensureButton(p);
  tracker.sync(posts);
  // Close a panel whose post was recycled or removed by X's virtualized list.
  if (panel.isOpen()) {
    const a = panel.anchor;
    const article = a?.closest("article");
    if (!a?.isConnected || !article || extractPost(article as HTMLElement).statusId !== panel.statusId) {
      panel.close(false);
    }
  }
}

let scanTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleScan(): void {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scan();
  }, 50);
}

function isOwnNode(n: Node): boolean {
  return n instanceof Element && (n.tagName === BUTTON_TAG.toUpperCase() || n.tagName === PANEL_TAG.toUpperCase());
}

const mo = new MutationObserver((records) => {
  let relevant = false;
  for (const r of records) {
    if (r.type === "attributes") {
      // Tab switch (For you ↔ Following on the same URL): act immediately, before any timer can fire.
      if (detectContext().context !== context) scan();
      relevant = true;
      continue;
    }
    const nodes = [...r.addedNodes, ...r.removedNodes];
    if (nodes.length > 0 && nodes.every(isOwnNode)) continue;
    relevant = true;
  }
  if (relevant) scheduleScan();
});

async function start(): Promise<void> {
  settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    const prev = settings;
    settings = parseSettings(changes[SETTINGS_KEY].newValue);
    if (settings.epoch !== prev.epoch) {
      // Data deleted: pending timers must not resurrect anything.
      tracker.cancelAll();
      tracker.resetCounted();
    }
    if (!settings.recording && prev.recording) tracker.cancelAll();
    if (settings.recording && !prev.recording) tracker.rearm();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tracker.rearm();
    else tracker.cancelAll();
  });
  window.addEventListener("popstate", scheduleScan);
  window.addEventListener("pagehide", () => tracker.cancelAll());
  // URL changes made by X's router without DOM mutations are caught by this cheap poll.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scan();
    }
  }, 300);
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-selected", "lang"],
  });
  scan();
}

void start();
