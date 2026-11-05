import { CATALOG_VERSION, TOPICS, topicById } from "../../shared/catalog";
import type { Classification } from "../../shared/classify";
import { formatDateTime, formatDay, formatInt, formatPct, formatPeriod, formatPp, formatUtcDay } from "../../shared/format";
import { ALL_LANGUAGES_NOUN, interpretTopic, interpretUnknown, languageNoun } from "../../shared/interpret";
import { languageName } from "../../shared/language";
import type { PanelResponse } from "../../shared/messages";
import {
  MIN_SAMPLE_FOR_DIRECTION,
  RETENTION_DAYS,
  langOf,
  type ExposureLike,
  type PanelMetrics,
  type PeriodInfo,
  type ScopedMetrics,
} from "../../shared/metrics";
import type { TrendResult, WikiTrend } from "../../shared/wiki";
import type { PostInfo } from "../xAdapter";
import { h, ISOLATED_EVENTS, isolateEvents } from "./dom";
import { PANEL_CSS } from "./styles";

export interface PanelOpenArgs {
  anchor: HTMLElement;
  returnFocus: HTMLElement;
  post: PostInfo;
  classification: Classification;
  recording: boolean;
  theme: "light" | "dark";
  requestMetrics(topicIds: string[]): Promise<PanelResponse | null>;
  requestTrend(topicId: string): Promise<TrendResult | null>;
  onClose(): void;
}

type ScopeKey = "lang" | "all";

interface Scope {
  key: ScopeKey;
  /** Column header, e.g. "Japanese" / "All languages". */
  header: string;
  /** Sentence noun, e.g. "Japanese posts" / "posts across all languages". */
  noun: string;
  m: PanelMetrics;
}

export class FeedPanel {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private args: PanelOpenArgs | null = null;
  private selected: string | null = null;
  private metrics: ScopedMetrics | null = null;
  private metricsState: "loading" | "ok" | "error" = "loading";
  private trends = new Map<string, TrendResult | "loading">();
  private body: HTMLElement | null = null;
  private readonly onDocPointer = (e: Event) => {
    if (!this.host || !this.args) return;
    const path = e.composedPath();
    if (path.includes(this.host) || path.includes(this.args.anchor)) return;
    this.close(false);
  };
  private readonly onReposition = () => this.position();

  get statusId(): string | null {
    return this.args?.post.statusId ?? null;
  }

  get anchor(): HTMLElement | null {
    return this.args?.anchor ?? null;
  }

  isOpen(): boolean {
    return this.host !== null;
  }

  open(args: PanelOpenArgs): void {
    this.close(false);
    this.args = args;
    this.selected = args.classification.matches[0]?.topicId ?? null;
    this.metrics = null;
    this.metricsState = "loading";
    this.trends.clear();

    const host = document.createElement("x-feed-lens-panel");
    host.setAttribute("data-theme", args.theme);
    const root = host.attachShadow({ mode: "open" });
    isolateEvents(host, ISOLATED_EVENTS);
    root.append(h("style", {}, PANEL_CSS));
    const titleId = "fl-title";
    const panel = h("div", {
      class: "panel",
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": titleId,
      tabindex: "-1",
    });
    const close = h("button", { class: "close", type: "button", "aria-label": "Close feed context" }, "×");
    close.addEventListener("click", () => this.close(true));
    panel.append(h("header", {}, h("h2", { id: titleId }, "Feed context"), close));
    panel.append(this.topicRow());
    this.body = h("div", { class: "body" });
    panel.append(this.body);
    panel.append(
      h(
        "footer",
        {},
        `Catalog v${CATALOG_VERSION} · Counts are computed on this device from posts recorded on your For you timeline.`,
      ),
    );
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close(true);
      }
    });
    root.append(panel);
    document.body.append(host);
    this.host = host;
    this.root = root;
    this.position();
    this.render();
    panel.focus({ preventScroll: true });
    document.addEventListener("pointerdown", this.onDocPointer, true);
    window.addEventListener("resize", this.onReposition);

    const ids = args.classification.matches.map((m) => m.topicId);
    args
      .requestMetrics(ids)
      .then((res) => {
        if (this.args !== args) return;
        if (res?.ok) {
          this.metrics = res.metrics;
          this.metricsState = "ok";
        } else this.metricsState = "error";
        this.render();
      })
      .catch(() => {
        if (this.args !== args) return;
        this.metricsState = "error";
        this.render();
      });
    if (this.selected) this.loadTrend(this.selected);
  }

  close(restoreFocus: boolean): void {
    if (!this.host) return;
    const args = this.args;
    this.host.remove();
    this.host = null;
    this.root = null;
    this.body = null;
    this.args = null;
    document.removeEventListener("pointerdown", this.onDocPointer, true);
    window.removeEventListener("resize", this.onReposition);
    args?.onClose();
    if (restoreFocus && args?.returnFocus.isConnected) args.returnFocus.focus({ preventScroll: true });
  }

  /** Anchored below the button (above it if there is no room), in document coordinates so it scrolls with the post. */
  position(): void {
    if (!this.host || !this.args) return;
    const r = this.args.anchor.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const panelH = this.host.getBoundingClientRect().height || 420;
    const below = window.innerHeight - r.bottom;
    const placeAbove = below < panelH + 12 && r.top > below;
    const top = placeAbove ? r.top - panelH - 6 : r.bottom + 6;
    this.host.style.left = `${left + window.scrollX}px`;
    this.host.style.top = `${Math.max(8, top) + window.scrollY}px`;
  }

  private loadTrend(topicId: string): void {
    const args = this.args;
    if (!args || this.trends.has(topicId)) return;
    this.trends.set(topicId, "loading");
    args
      .requestTrend(topicId)
      .then((r) => {
        if (this.args !== args) return;
        this.trends.set(topicId, r ?? { status: "error", kind: "http", message: "No response from the extension." });
        this.render();
      })
      .catch(() => {
        if (this.args !== args) return;
        this.trends.set(topicId, { status: "error", kind: "http", message: "No response from the extension." });
        this.render();
      });
  }

  private topicRow(): HTMLElement {
    const matches = this.args!.classification.matches;
    const row = h("div", { class: "topicrow", "data-testid": "fl-topic-row" });
    if (matches.length === 0) {
      row.append(h("span", { class: "topic", "data-testid": "fl-topic" }, "No recognized topic"));
      return row;
    }
    row.append(h("span", { class: "muted" }, "Topic:"));
    if (matches.length === 1) {
      row.append(h("span", { class: "topic", "data-testid": "fl-topic" }, matches[0]!.label));
      return row;
    }
    const group = h("div", { role: "group", "aria-label": "Topics in this post", class: "topicrow" });
    for (const m of matches) {
      const chip = h(
        "button",
        {
          type: "button",
          class: "chip",
          "data-topic": m.topicId,
          "aria-pressed": String(m.topicId === this.selected),
          "data-testid": m.topicId === this.selected ? "fl-topic" : undefined,
        },
        m.label,
      );
      chip.addEventListener("click", () => {
        this.selected = m.topicId;
        for (const c of group.querySelectorAll<HTMLButtonElement>(".chip")) {
          const on = c.dataset.topic === m.topicId;
          c.setAttribute("aria-pressed", String(on));
          if (on) c.setAttribute("data-testid", "fl-topic");
          else c.removeAttribute("data-testid");
        }
        this.loadTrend(m.topicId);
        this.render();
      });
      group.append(chip);
    }
    row.append(group);
    return row;
  }

  private render(): void {
    if (!this.body || !this.args) return;
    const b = this.body;
    b.replaceChildren();
    const args = this.args;
    if (!args.recording) {
      b.append(
        h(
          "p",
          { class: "note", "data-testid": "fl-recording-off" },
          "Recording is off or paused, so new posts are not being counted. Turn it on from the X Feed Lens toolbar button.",
        ),
      );
    }
    if (this.metricsState === "loading") {
      b.append(h("p", { class: "muted", "data-testid": "fl-loading" }, "Loading your counts…"));
      return;
    }
    if (this.metricsState === "error" || !this.metrics) {
      b.append(h("p", { class: "note" }, "Could not read local history. Reload the page and try again."));
      return;
    }
    const sm = this.metrics;
    const scopes = this.scopes(sm);
    const all = sm.all;
    const empty = all.currentTotal === 0 && all.previousTotal === 0;
    if (empty) {
      b.append(
        h(
          "div",
          { class: "empty", "data-testid": "fl-empty" },
          h("strong", {}, "No qualifying exposures yet. "),
          "A post is recorded after at least half of it stays on screen for one second on your For you timeline while recording is on. " +
            "Opening this panel never records anything.",
        ),
      );
    }
    if (!empty) {
      if (this.selected) b.append(this.metricsSection(this.selected, scopes));
      else b.append(this.unknownSection(scopes));
    }
    if (this.selected) b.append(this.trendSection(this.selected));
    b.append(this.whySection(scopes));
    this.position();
  }

  private scopes(sm: ScopedMetrics): Scope[] {
    const name = languageName(sm.lang);
    return [
      { key: "lang", header: sm.lang === "und" ? "Undetermined language" : name, noun: languageNoun(sm.lang, name), m: sm.language },
      { key: "all", header: "All languages", noun: ALL_LANGUAGES_NOUN, m: sm.all },
    ];
  }

  /** Header row + one row per metric, one column per scope. */
  private table(rows: { label: string; detail?: string; cells: (sc: Scope) => [string, string, string] }[], scopes: Scope[]): HTMLElement {
    const table = h("table", { class: "scopes", "data-testid": "fl-scopes" });
    const head = h("tr", {}, h("th", { scope: "col" }, ""));
    for (const sc of scopes) head.append(h("th", { scope: "col", "data-testid": `fl-scope-${sc.key}` }, sc.header));
    table.append(h("thead", {}, head));
    const body = h("tbody");
    for (const row of rows) {
      const tr = h("tr", {}, h("th", { scope: "row" }, row.label, row.detail ? h("span", { class: "sub" }, row.detail) : null));
      for (const sc of scopes) {
        const [testId, value, detail] = row.cells(sc);
        tr.append(
          h(
            "td",
            {},
            h("span", { class: /^[\d+−—]/.test(value) ? "value" : "value word", "data-testid": `${testId}-${sc.key}` }, value),
            h("span", { class: "sub", "data-testid": `${testId}-${sc.key}-detail` }, detail),
          ),
        );
      }
      body.append(tr);
    }
    table.append(body);
    return table;
  }

  private metricsSection(topicId: string, scopes: Scope[]): HTMLElement {
    const def = topicById(topicId)!;
    const tm = (sc: Scope) => sc.m.topics.find((t) => t.topicId === topicId)!;
    const p = scopes[1]!.m;
    const s = h("section", { "data-testid": "fl-metrics" });
    s.append(h("h3", {}, `Your feed · ${periodLabel(p.current)}`));
    s.append(
      this.table(
        [
          {
            label: "Feed share",
            detail: "last 7 days",
            cells: (sc) => {
              const t = tm(sc);
              return ["fl-share", formatPct(t.current.pct), `${t.current.matching} of ${t.current.total}`];
            },
          },
          {
            label: "Previous 7 days",
            detail: formatPeriod(p.previous.start, p.previous.end),
            cells: (sc) => {
              const t = tm(sc);
              return ["fl-prev", formatPct(t.previous.pct), `${t.previous.matching} of ${t.previous.total}`];
            },
          },
          {
            label: "Change",
            detail: "percentage points",
            cells: (sc) => {
              const c = tm(sc).change;
              if (c.status === "none") return ["fl-change", "No comparison yet", "an empty period"];
              if (c.status === "insufficient") return ["fl-change", "Not assessed", `fewer than ${MIN_SAMPLE_FOR_DIRECTION} posts`];
              return ["fl-change", `${formatPp(c.pp!)} pp`, c.direction === "flat" ? "about the same" : c.direction!];
            },
          },
          {
            label: "Repeated sources",
            detail: "top 2 authors",
            cells: (sc) => {
              const r = tm(sc).repeated;
              if (r.topicExposures === 0) return ["fl-repeated", "—", "no topic posts"];
              if (r.knownAuthorExposures === 0) return ["fl-repeated", "Unavailable", "no author handles"];
              const authors = `${r.distinctKnownAuthors} author${r.distinctKnownAuthors === 1 ? "" : "s"}`;
              const coverage = r.fullCoverage ? "" : ` · ${r.knownAuthorExposures}/${r.topicExposures} known`;
              return ["fl-repeated", formatPct(r.pct), `${r.topTwoExposures} of ${r.topicExposures} · ${authors}${coverage}`];
            },
          },
        ],
        scopes,
      ),
    );
    const partial = periodNotes(p);
    if (partial) s.append(partial);
    for (const sc of scopes) {
      s.append(h("p", { class: "sentence", "data-testid": `fl-sentence-${sc.key}` }, interpretTopic(tm(sc), def.phrase, sc.noun)));
    }
    return s;
  }

  private unknownSection(scopes: Scope[]): HTMLElement {
    const p = scopes[1]!.m;
    const s = h("section", { "data-testid": "fl-metrics" });
    s.append(h("h3", {}, `Your feed · ${periodLabel(p.current)}`));
    s.append(
      this.table(
        [
          {
            label: "Recorded posts",
            detail: "last 7 days",
            cells: (sc) => ["fl-total", formatInt(sc.m.currentTotal), `previous: ${sc.m.previousTotal}`],
          },
          {
            label: "No catalog topic",
            detail: "last 7 days",
            cells: (sc) => [
              "fl-unmatched",
              sc.m.currentTotal ? formatPct((sc.m.unmatchedCurrent / sc.m.currentTotal) * 100) : "—",
              `${sc.m.unmatchedCurrent} of ${sc.m.currentTotal}`,
            ],
          },
        ],
        scopes,
      ),
    );
    const partial = periodNotes(p);
    if (partial) s.append(partial);
    s.append(h("p", { class: "sentence", "data-testid": "fl-sentence-unknown" }, "This post matched no catalog topic."));
    for (const sc of scopes) {
      s.append(h("p", { class: "sentence", "data-testid": `fl-sentence-${sc.key}` }, interpretUnknown(sc.m, sc.noun)));
    }
    return s;
  }

  private trendSection(topicId: string): HTMLElement {
    const s = h("section", { "data-testid": "fl-trend" });
    s.append(h("h3", {}, "English Wikipedia article views"));
    const st = this.trends.get(topicId);
    const def = topicById(topicId)!;
    if (!def.wikipedia) {
      s.append(h("p", { class: "muted", "data-testid": "fl-trend-status" }, def.noPublicSeriesReason ?? "No comparable public series."));
      return s;
    }
    if (!st || st === "loading") {
      s.append(h("p", { class: "muted", "data-testid": "fl-trend-status" }, "Looking up public pageviews…"));
      return s;
    }
    switch (st.status) {
      case "disabled":
        s.append(
          h(
            "p",
            { class: "muted", "data-testid": "fl-trend-status" },
            "Public lookups are off. Turn them on in the X Feed Lens toolbar popup to compare with English Wikipedia readership.",
          ),
        );
        break;
      case "no-series":
        s.append(h("p", { class: "muted", "data-testid": "fl-trend-status" }, st.reason));
        break;
      case "ok":
        s.append(trendBody(st.trend, st.fetchedAt, st.fromCache ? "cached" : "live"));
        break;
      case "error":
        s.append(h("p", { class: "note", "data-testid": "fl-trend-status" }, st.message));
        if (st.cached) s.append(trendBody(st.cached.trend, st.cached.fetchedAt, "cached-fallback"));
        break;
    }
    s.append(
      h(
        "p",
        { class: "muted" },
        "Readership of one specific article, from the Wikimedia Analytics API (CC0). It is a separate signal and is not comparable to your feed share.",
      ),
    );
    return s;
  }

  private whySection(scopes: Scope[]): HTMLElement {
    const args = this.args!;
    const [langScope, allScope] = scopes as [Scope, Scope];
    const lang = this.metrics!.lang;
    const d = h("details", { "data-testid": "fl-why" });
    d.append(h("summary", {}, "Why this result?"));
    const match = args.classification.matches.find((x) => x.topicId === this.selected);
    d.append(
      h(
        "p",
        { "data-testid": "fl-post-language" },
        h("strong", {}, "Post language: "),
        `${langScope.header} (from X's own language tag). The first column only counts posts X tagged with the same language; ` +
          "the second counts every recorded post.",
      ),
    );
    if (match) {
      const def = topicById(match.topicId)!;
      d.append(h("p", {}, h("strong", {}, "Matched terms in this post: "), match.matchedTerms.join(", ")));
      d.append(h("p", {}, h("strong", {}, "Inclusion rule: "), def.rule));
      // Tool names are the same word in most languages; only the claim depends on local vocabulary.
      if (def.kind === "claim" && lang !== "en" && lang !== "und" && !def.vocabularyLanguages.includes(lang)) {
        d.append(
          h(
            "p",
            { class: "note", "data-testid": "fl-vocab-note" },
            `No dedicated ${langScope.header} vocabulary for this topic: only language-independent terms (such as the Latin name) ` +
              `can match, so the ${langScope.header} share may be undercounted.`,
          ),
        );
      }
    } else {
      d.append(
        h(
          "p",
          { "data-testid": "fl-coverage" },
          h("strong", {}, "Coverage: "),
          `The bundled catalog (v${CATALOG_VERSION}) recognizes ${TOPICS.length} topics: ${TOPICS.map((x) => x.label).join(", ")}, ` +
            `with vocabulary for English and ${[...new Set(TOPICS.flatMap((x) => x.vocabularyLanguages))].map(languageName).join(", ")}. ` +
            "This post matched none of them. Unmatched posts still count in the denominator, so shares for catalog topics stay honest.",
        ),
      );
    }
    d.append(
      h(
        "p",
        {},
        h("strong", {}, "Counted as an exposure: "),
        "a text post in any language on your For you timeline with at least half of it (or half the screen height, for tall posts) " +
          "visible for one continuous second while the tab is visible. Ads, media-only posts, quoted cards and other pages are excluded. " +
          "Each post counts once per tab session.",
      ),
    );
    d.append(
      h(
        "p",
        { "data-testid": "fl-sample" },
        h("strong", {}, "Recorded sample: "),
        `${langScope.header}: ${langScope.m.currentTotal} posts in the last 7 days, ${langScope.m.previousTotal} in the previous 7 days. ` +
          `All languages: ${allScope.m.currentTotal} and ${allScope.m.previousTotal} ` +
          `(${allScope.m.retainedTotal} kept in the last ${RETENTION_DAYS} days of local history).`,
      ),
    );
    const t = this.selected ? allScope.m.topics.find((x) => x.topicId === this.selected) : undefined;
    if (t) {
      for (const sc of scopes) {
        const r = sc.m.topics.find((x) => x.topicId === this.selected)!.repeated;
        if (r.topAuthors.length === 0) continue;
        d.append(
          h(
            "p",
            { "data-testid": `fl-authors-${sc.key}` },
            h("strong", {}, `Most frequent authors (${sc.header}): `),
            r.topAuthors.map((a) => `@${a.author} (${a.count})`).join(", ") +
              (r.fullCoverage ? "" : `. Author known for ${r.knownAuthorExposures} of ${r.topicExposures} posts; unknown authors are not attributed.`),
          ),
        );
      }
    }
    if (t && t.evidence.length > 0) {
      d.append(h("p", {}, h("strong", {}, "Contributing posts (most recent, all languages):")));
      const ul = h("ul", { class: "evidence", "data-testid": "fl-evidence" });
      for (const e of t.evidence) ul.append(evidenceItem(e));
      d.append(ul);
    } else if (t) {
      d.append(h("p", { class: "muted" }, "No recorded posts for this topic in the last 7 days yet."));
    }
    return d;
  }
}

function periodLabel(p: PeriodInfo): string {
  return `${formatPeriod(p.start, p.end)}${p.ongoing ? " (to date)" : ""}`;
}

function periodNotes(m: PanelMetrics): HTMLElement | null {
  const notes = [periodNote(m.current, "Last 7 days"), periodNote(m.previous, "Previous 7 days")].filter(Boolean) as string[];
  if (notes.length === 0) return null;
  return h("p", { class: "note small", "data-testid": "fl-partial" }, notes.join(" "));
}

function periodNote(p: PeriodInfo, which: string): string | null {
  if (!p.partial) return null;
  const parts: string[] = [];
  if (p.observedFrom > p.start) {
    parts.push(
      p.observedFrom >= p.end
        ? "not observed (recording started later)"
        : `observed only from ${formatDay(p.observedFrom)} (recording started then)`,
    );
  }
  if (p.pausedDuring) parts.push("recording was paused for part of it");
  return `${which} is a partial period: ${parts.join("; ")}.`;
}

function evidenceItem(e: ExposureLike): HTMLElement {
  const url = e.author ? `https://x.com/${e.author}/status/${e.statusId}` : `https://x.com/i/status/${e.statusId}`;
  return h(
    "li",
    {},
    h(
      "div",
      { class: "meta" },
      `${e.author ? `@${e.author}` : "Unknown author"} · ${languageName(langOf(e))} · seen ${formatDateTime(e.ts)}`,
    ),
    h("div", {}, e.excerpt ?? ""),
    h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Open on X"),
  );
}

function trendBody(t: WikiTrend, fetchedAt: number, source: "live" | "cached" | "cached-fallback"): HTMLElement {
  const wrap = h("div", { "data-testid": "fl-trend-body" });
  const dirText =
    t.direction === null
      ? "Direction not stated (missing days)"
      : t.direction === "up-from-zero"
        ? "Up from zero"
        : t.direction === "zero"
          ? "No views in either period"
          : t.direction === "flat"
            ? `About the same (${formatSigned(t.pctChange!)}%)`
            : `${t.direction === "up" ? "Up" : "Down"} ${formatSigned(t.pctChange!)}%`;
  wrap.append(
    h(
      "div",
      { class: "metric" },
      h("span", { class: "name" }, h("a", { href: t.articleUrl, target: "_blank", rel: "noopener noreferrer" }, t.article.replaceAll("_", " "))),
      h("span", { class: "value", "data-testid": "fl-trend-direction" }, dirText),
      h(
        "span",
        { class: "detail", "data-testid": "fl-trend-current" },
        `${formatUtcDay(t.current.start)} – ${formatUtcDay(t.current.end)} (UTC): ${formatInt(t.current.total)} views`,
      ),
      h(
        "span",
        { class: "detail", "data-testid": "fl-trend-previous" },
        `${formatUtcDay(t.previous.start)} – ${formatUtcDay(t.previous.end)} (UTC): ${formatInt(t.previous.total)} views`,
      ),
    ),
  );
  const notes: string[] = [];
  if (t.incomplete) notes.push(`missing days: ${t.current.missingDays} current, ${t.previous.missingDays} previous`);
  if (t.delayed) notes.push(`data delayed; latest available day is ${formatUtcDay(t.latestDay)}`);
  if (notes.length) wrap.append(h("p", { class: "note" }, `Note: ${notes.join("; ")}.`));
  const srcText =
    source === "live" ? "Updated" : source === "cached" ? "Cached result from" : "Showing cached result from";
  wrap.append(h("p", { class: "muted", "data-testid": "fl-trend-updated" }, `${srcText} ${formatDateTime(fetchedAt)}.`));
  return wrap;
}

function formatSigned(x: number): string {
  const r = Math.round(x * 10) / 10;
  return r > 0 ? `+${r}` : `${r}`;
}
