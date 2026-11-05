import { CATALOG_VERSION, TOPICS, topicById } from "../../shared/catalog";
import type { Classification } from "../../shared/classify";
import { formatDateTime, formatDay, formatInt, formatPct, formatPeriod, formatPp, formatUtcDay } from "../../shared/format";
import { ALL_LANGUAGES_NOUN, interpretSemantic, interpretTopic, languageNoun } from "../../shared/interpret";
import { languageName } from "../../shared/language";
import { makeExcerpt, type EvidenceItem, type PanelResponse, type SemanticResponse, type SemanticResult, type SemanticState } from "../../shared/messages";
import {
  MIN_SAMPLE_FOR_DIRECTION,
  RETENTION_DAYS,
  langOf,
  type ExposureLike,
  type PanelMetrics,
  type PeriodInfo,
  type ScopedMetrics,
} from "../../shared/metrics";
import type { SemanticChange, SemanticScope } from "../../shared/semanticMetrics";
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
  /** Starts or polls the automatic semantic comparison for this request ID. */
  pollSemantic(requestId: string): Promise<SemanticResponse | null>;
  cancelSemantic(requestId: string, keepPartial: boolean): Promise<SemanticResponse | null>;
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

interface SemScope {
  key: ScopeKey;
  header: string;
  noun: string;
  s: SemanticScope;
}

/** "semantic" = Similar to this post (primary); otherwise a catalog topic ID. */
type Mode = "semantic" | string;

const POLL_MS = 350;

export class FeedPanel {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private args: PanelOpenArgs | null = null;
  private mode: Mode = "semantic";
  private metrics: ScopedMetrics | null = null;
  private metricsState: "loading" | "ok" | "error" = "loading";
  private trends = new Map<string, TrendResult | "loading">();
  private body: HTMLElement | null = null;
  private semId: string | null = null;
  private sem: SemanticState | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private whyOpen = false;
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
    this.mode = "semantic";
    this.metrics = null;
    this.metricsState = "loading";
    this.trends.clear();
    this.whyOpen = false;

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
    panel.append(
      h(
        "blockquote",
        { class: "target", "data-testid": "fl-post-excerpt" },
        h("span", { class: "muted" }, args.post.author ? `@${args.post.author}: ` : "This post: "),
        makeExcerpt(args.post.text),
      ),
    );
    panel.append(this.modeChips());
    this.body = h("div", { class: "body", "aria-live": "polite" });
    panel.append(this.body);
    panel.append(h("footer", {}, `Computed on this device from posts recorded on your For you timeline. Catalog v${CATALOG_VERSION}.`));
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

    this.loadMetrics();
    this.startSemantic();
  }

  /** Local data was deleted while the panel is open: discard shown results and recompute. */
  refresh(): void {
    if (!this.args) return;
    this.metrics = null;
    this.metricsState = "loading";
    this.trends.clear();
    this.loadMetrics();
    this.startSemantic();
    if (this.mode !== "semantic") this.loadTrend(this.mode);
  }

  close(restoreFocus: boolean): void {
    if (!this.host) return;
    const args = this.args;
    this.stopPolling(true);
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
    const width = Math.min(400, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const panelH = this.host.getBoundingClientRect().height || 420;
    const below = window.innerHeight - r.bottom;
    const placeAbove = below < panelH + 12 && r.top > below;
    const top = placeAbove ? r.top - panelH - 6 : r.bottom + 6;
    this.host.style.left = `${left + window.scrollX}px`;
    this.host.style.top = `${Math.max(8, top) + window.scrollY}px`;
  }

  // ───────────── data loading ─────────────

  private loadMetrics(): void {
    const args = this.args!;
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
  }

  private stopPolling(cancel: boolean): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    const id = this.semId;
    if (cancel && id && this.args && this.sem?.phase === "working") void this.args.cancelSemantic(id, false).catch(() => null);
    this.semId = null;
  }

  /** Every start gets a fresh request ID; replies for any other ID are ignored. */
  private startSemantic(): void {
    const args = this.args!;
    this.stopPolling(true);
    const id = crypto.randomUUID();
    this.semId = id;
    this.sem = { phase: "working", stage: "indexing", done: 0, total: 0 };
    this.render();
    const tick = async () => {
      this.pollTimer = null;
      if (this.args !== args || this.semId !== id) return;
      let r: SemanticResponse | null = null;
      try {
        r = await args.pollSemantic(id);
      } catch {
        r = null;
      }
      if (this.args !== args || this.semId !== id) return; // a newer request or another post owns the panel
      this.sem = r?.ok
        ? r.state
        : { phase: "error", kind: "inference", message: "No response from the extension. Reload the page and try again." };
      this.render();
      if (this.sem.phase === "working") this.pollTimer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
  }

  private stopSemantic(): void {
    const args = this.args;
    const id = this.semId;
    if (!args || !id) return;
    void args.cancelSemantic(id, true).catch(() => null); // keep counts from what is already analyzed; polling continues
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

  // ───────────── rendering ─────────────

  private modeChips(): HTMLElement {
    const matches = this.args!.classification.matches;
    const group = h("div", { role: "group", "aria-label": "What to compare", class: "topicrow", "data-testid": "fl-modes" });
    const chip = (mode: Mode, label: string) => {
      const b = h(
        "button",
        { type: "button", class: "chip", "data-mode": mode, "data-testid": `fl-mode-${mode}`, "aria-pressed": String(mode === this.mode) },
        label,
      );
      b.addEventListener("click", () => {
        this.mode = mode;
        for (const c of group.querySelectorAll<HTMLButtonElement>(".chip")) c.setAttribute("aria-pressed", String(c.dataset.mode === mode));
        if (mode !== "semantic") this.loadTrend(mode);
        this.render();
      });
      return b;
    };
    group.append(chip("semantic", "Similar to this post"));
    if (matches.length > 0) {
      group.append(h("span", { class: "muted sep" }, "Catalog topics:"));
      for (const m of matches) group.append(chip(m.topicId, m.label));
    }
    return group;
  }

  private render(): void {
    if (!this.body || !this.args) return;
    const b = this.body;
    // Keep keyboard focus on the same control across re-renders (progress updates, results).
    const focusKey = (this.root?.activeElement as HTMLElement | null)?.dataset?.testid;
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
    if (this.mode === "semantic") this.renderSemantic(b);
    else this.renderCatalog(b, this.mode);
    if (focusKey) (this.root?.querySelector(`[data-testid="${focusKey}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    this.position();
  }

  // ───── semantic (primary) ─────

  private renderSemantic(b: HTMLElement): void {
    b.append(h("h3", { "data-testid": "fl-mode-title" }, "Similar to this post"));
    const st = this.sem;
    if (!st) return;
    switch (st.phase) {
      case "working": {
        const label =
          st.stage === "loading-model"
            ? "Loading the local language model…"
            : st.stage === "scoring"
              ? "Comparing with your recorded posts…"
              : st.total > 0
                ? `Analyzing your recorded posts: ${formatInt(st.done)} of ${formatInt(st.total)}`
                : "Reading your recorded posts…";
        const stop = h("button", { type: "button", class: "btn", "data-testid": "fl-sem-stop" }, "Stop");
        stop.addEventListener("click", () => this.stopSemantic());
        b.append(
          h(
            "div",
            { class: "progress", "data-testid": "fl-sem-progress", role: "status" },
            h("span", {}, label),
            st.total > 0 ? h("progress", { max: String(st.total), value: String(st.done), "aria-label": "Analysis progress" }) : null,
            st.total > 0 ? stop : null,
          ),
        );
        b.append(h("p", { class: "muted" }, "Runs entirely on this device. You can keep scrolling or close this panel."));
        break;
      }
      case "error": {
        const msg =
          st.kind === "model-unavailable"
            ? "The local language model could not be loaded, so relatedness was not analyzed."
            : st.kind === "timeout"
              ? "The local language model took too long, so relatedness was not analyzed."
              : st.kind === "deleted"
                ? "Local data was deleted while this analysis was running."
                : st.kind === "storage"
                  ? "Local history could not be read, so relatedness was not analyzed."
                  : "The analysis failed, so relatedness was not analyzed.";
        b.append(
          h(
            "div",
            { class: "note block", "data-testid": "fl-sem-error", role: "alert" },
            h("strong", {}, msg),
            " This is not a result: no posts were judged related or unrelated. ",
            h("span", { class: "muted", "data-testid": "fl-sem-error-detail" }, st.message),
          ),
        );
        b.append(this.retryButton("Try again"));
        if (this.args!.classification.matches.length > 0) {
          b.append(h("p", { class: "muted" }, "The catalog topic buttons above still work."));
        }
        break;
      }
      case "cancelled":
        b.append(h("p", { class: "note", "data-testid": "fl-sem-cancelled" }, "Analysis stopped before this post could be compared."));
        b.append(this.retryButton("Analyze again"));
        break;
      case "done":
        this.renderSemanticResult(b, st.result);
        break;
    }
  }

  private retryButton(label: string): HTMLElement {
    const btn = h("button", { type: "button", class: "btn primary", "data-testid": "fl-sem-retry" }, label);
    btn.addEventListener("click", () => this.startSemantic());
    return btn;
  }

  private semScopes(r: SemanticResult): SemScope[] {
    const m = r.metrics!;
    const name = languageName(m.lang);
    return [
      { key: "lang", header: m.lang === "und" ? "Undetermined language" : name, noun: languageNoun(m.lang, name), s: m.language },
      { key: "all", header: "All languages", noun: ALL_LANGUAGES_NOUN, s: m.all },
    ];
  }

  private renderSemanticResult(b: HTMLElement, r: SemanticResult): void {
    if (r.outcome === "insufficient-text") {
      b.append(
        h(
          "div",
          { class: "empty", "data-testid": "fl-sem-insufficient" },
          h("strong", {}, "Too little text to compare. "),
          "This post has almost no words (for example only emoji, links or a single word), so its meaning cannot be estimated. " +
            "This does not mean that nothing related was recorded.",
        ),
      );
      b.append(this.whySemantic(r));
      return;
    }
    if (r.outcome === "empty-history") {
      b.append(
        h(
          "div",
          { class: "empty", "data-testid": "fl-sem-empty" },
          h("strong", {}, "No other recorded posts yet. "),
          "A post is recorded after at least half of it stays on screen for one second on your For you timeline while recording is on. " +
            "Opening this panel never records anything.",
        ),
      );
      b.append(this.whySemantic(r));
      return;
    }
    const m = r.metrics!;
    const scopes = this.semScopes(r);
    const all = m.all;
    const analyzed = all.current.assessed + all.previous.assessed;
    const noMatches = all.current.related + all.previous.related === 0 && analyzed > 0;
    const s = h("section", {
      "data-testid": "fl-sem-metrics",
      // Diagnostics for benchmarks and tests (not shown).
      "data-total-ms": String(Math.round(r.timings.totalMs)),
      "data-encoded": String(r.timings.encoded),
      "data-cached": String(r.timings.cached),
    });
    s.append(h("p", { class: "small muted" }, `Your feed · ${periodLabel(m.currentInfo)}`));
    if (r.partial) {
      const cont = h("button", { type: "button", class: "btn", "data-testid": "fl-sem-continue" }, "Finish analysis");
      cont.addEventListener("click", () => this.startSemantic());
      s.append(
        h(
          "div",
          { class: "note block", "data-testid": "fl-sem-partial" },
          `Partial result: ${formatInt(all.current.pending + all.previous.pending)} recorded posts were not analyzed yet and are not counted as unrelated. `,
          cont,
        ),
      );
    }
    if (noMatches) {
      s.append(
        h(
          "p",
          { class: "note", "data-testid": "fl-sem-nomatch" },
          `No related posts found among ${formatInt(analyzed)} analyzed other recorded posts from the last 14 days.`,
        ),
      );
    }
    s.append(
      semanticTable(
        [
          {
            label: "Related recorded posts",
            detail: "of analyzed other posts, last 7 days",
            cells: (sc) => ["fl-related", formatPct(sc.s.current.share.pct), `${sc.s.current.related} of ${sc.s.current.assessed}`],
          },
          {
            label: "Previous 7 days",
            detail: formatPeriod(m.previousInfo.start, m.previousInfo.end),
            cells: (sc) => ["fl-rprev", formatPct(sc.s.previous.share.pct), `${sc.s.previous.related} of ${sc.s.previous.assessed}`],
          },
          { label: "Change", detail: "percentage points", cells: (sc) => ["fl-rchange", ...changeCell(sc.s.change)] },
          {
            label: "Repeated authors",
            detail: "top 2, related posts",
            cells: (sc) => {
              const rp = sc.s.repeated;
              if (rp.topicExposures === 0) return ["fl-rauthors", "—", "no related posts"];
              if (rp.knownAuthorExposures === 0) return ["fl-rauthors", "Unavailable", "no author handles"];
              const authors = `${rp.distinctKnownAuthors} author${rp.distinctKnownAuthors === 1 ? "" : "s"}`;
              return ["fl-rauthors", formatPct(rp.pct), `${rp.topTwoExposures} of ${rp.topicExposures} · ${authors}`];
            },
          },
          {
            label: "Other recorded posts",
            detail: "last 7 days, analyzed",
            cells: (sc) => {
              const c = sc.s.current;
              const extra = [c.pending ? `${c.pending} pending` : "", c.unassessable ? `${c.unassessable} no text` : ""].filter(Boolean).join(" · ");
              return ["fl-analyzed", formatInt(c.eligible), `${c.assessed} analyzed (${formatPct(c.coverage)})${extra ? ` · ${extra}` : ""}`];
            },
          },
        ],
        scopes,
      ),
    );
    const notes = periodNotes(m.currentInfo, m.previousInfo);
    if (notes) s.append(notes);
    for (const sc of scopes) {
      s.append(h("p", { class: "sentence", "data-testid": `fl-sem-sentence-${sc.key}` }, interpretSemantic(sc.s, sc.noun)));
    }
    s.append(
      h(
        "p",
        { class: "muted small", "data-testid": "fl-sem-estimate" },
        "Relatedness is an estimate of whether two posts are about substantially the same subject, from a local language model. " +
          "It does not mean agreement: opposing opinions about the same subject both count.",
      ),
    );
    b.append(s);
    if (r.evidence.length > 0) {
      const ev = h("section", { "data-testid": "fl-sem-evidence-section" });
      ev.append(h("h3", {}, "Most similar recorded posts"));
      const ul = h("ul", { class: "evidence", "data-testid": "fl-sem-evidence" });
      for (const e of r.evidence) ul.append(semanticEvidenceItem(e));
      ev.append(ul);
      b.append(ev);
    }
    b.append(this.whySemantic(r));
  }

  private whySemantic(r: SemanticResult): HTMLElement {
    const d = this.details();
    const m = r.metrics;
    const args = this.args!;
    if (m) {
      const [lang, all] = this.semScopes(r) as [SemScope, SemScope];
      d.append(
        h(
          "p",
          { "data-testid": "fl-post-language" },
          h("strong", {}, "Post language: "),
          `${lang.header} (from X's own language tag). The first column only counts posts X tagged with the same language; the second counts every recorded post.`,
        ),
      );
      d.append(
        h(
          "p",
          { "data-testid": "fl-why-exclusion" },
          h("strong", {}, "This post is not counted: "),
          m.excludedSelf > 0
            ? `${m.excludedSelf} recorded exposure${m.excludedSelf === 1 ? "" : "s"} of this same post ${m.excludedSelf === 1 ? "was" : "were"} left out of every count, so a post cannot prove its own prevalence.`
            : "this post is not in your recorded history; every count is of other posts.",
        ),
      );
      const excerptRows = all.s.current.assessedFromExcerpt + all.s.previous.assessedFromExcerpt;
      d.append(
        h(
          "p",
          { "data-testid": "fl-why-excerpts" },
          h("strong", {}, "Older records analyzed from excerpts: "),
          excerptRows > 0
            ? `${excerptRows} analyzed post${excerptRows === 1 ? " was" : "s were"} recorded before full-text analysis existed, so only the stored 140-character excerpt was compared. Posts are never re-fetched from X.`
            : "none; every analyzed post was compared using its stored visible text.",
        ),
      );
      const unass = all.s.current.unassessable + all.s.previous.unassessable;
      const pend = all.s.current.pending + all.s.previous.pending;
      d.append(
        h(
          "p",
          { "data-testid": "fl-why-coverage" },
          h("strong", {}, "Coverage: "),
          `${analyzedOf(all.s)} other recorded posts in the last 14 days were analyzed. ` +
            (unass ? `${unass} had too little text (emoji or links only) and are left out rather than counted as unrelated. ` : "") +
            (pend ? `${pend} are still pending and are not counted as unrelated. ` : "") +
            "The share is related ÷ analyzed. A direction (up or down) is only stated when every post in both periods was analyzed " +
            `and each period has at least ${MIN_SAMPLE_FOR_DIRECTION} analyzed posts.`,
        ),
      );
      for (const sc of [lang, all]) {
        const rp = sc.s.repeated;
        if (rp.topAuthors.length === 0) continue;
        d.append(
          h(
            "p",
            { "data-testid": `fl-authors-${sc.key}` },
            h("strong", {}, `Most frequent authors among related posts (${sc.header}): `),
            rp.topAuthors.map((a) => `@${a.author} (${a.count})`).join(", ") +
              (rp.fullCoverage ? "" : `. Author known for ${rp.knownAuthorExposures} of ${rp.topicExposures} posts; unknown authors are not attributed.`),
          ),
        );
      }
      d.append(
        h(
          "p",
          { "data-testid": "fl-sample" },
          h("strong", {}, "Recorded sample: "),
          `${lang.header}: ${lang.s.current.eligible} other posts in the last 7 days, ${lang.s.previous.eligible} in the previous 7 days. ` +
            `All languages: ${all.s.current.eligible} and ${all.s.previous.eligible} (${formatInt(r.retainedTotal)} kept in the last ${RETENTION_DAYS} days of local history).`,
        ),
      );
    }
    d.append(
      h(
        "p",
        { "data-testid": "fl-why-model" },
        h("strong", {}, "How relatedness is decided: "),
        "both posts are turned into meaning vectors by a multilingual model that runs on this device " +
          `(${r.model.id.split("/").pop()}, ${r.model.license}). A post counts as related when the similarity passes a cutoff ` +
          "calibrated on labeled Chinese and English examples; a lower cutoff applies when the two posts are in different languages. " +
          "The similarity is not a probability." +
          (r.query.truncated ? " This post is long: only its first part was analyzed." : r.query.chunks > 1 ? ` This post was analyzed in ${r.query.chunks} parts.` : ""),
      ),
    );
    if (this.metrics && this.metricsState === "ok") {
      const unmatched = this.metrics.all.unmatchedCurrent;
      const total = this.metrics.all.currentTotal;
      d.append(
        h(
          "p",
          { "data-testid": "fl-why-catalog" },
          h("strong", {}, "Catalog coverage (diagnostic): "),
          args.classification.matches.length > 0
            ? `this post also matches catalog topics (${args.classification.matches.map((x) => x.label).join(", ")}); select one above for its own counts. `
            : "this post matches none of the bundled catalog topics. ",
          `${unmatched} of ${total} recorded posts in the last 7 days matched no catalog topic. That measures catalog coverage, not what those posts are about.`,
        ),
      );
    }
    d.append(exposureDefinition());
    return d;
  }

  private details(): HTMLDetailsElement {
    const d = h("details", { "data-testid": "fl-why" });
    if (this.whyOpen) d.open = true;
    d.addEventListener("toggle", () => (this.whyOpen = d.open));
    d.append(h("summary", { "data-testid": "fl-why-summary" }, "Why this result?"));
    return d;
  }

  // ───── catalog topics (secondary) ─────

  private renderCatalog(b: HTMLElement, topicId: string): void {
    const def = topicById(topicId)!;
    b.append(h("h3", { "data-testid": "fl-mode-title" }, "Catalog topic: ", h("span", { "data-testid": "fl-topic" }, def.label)));
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
    const empty = sm.all.currentTotal === 0 && sm.all.previousTotal === 0;
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
    } else b.append(this.metricsSection(topicId, scopes));
    b.append(this.trendSection(topicId));
    b.append(this.whyCatalog(topicId, scopes));
  }

  private scopes(sm: ScopedMetrics): Scope[] {
    const name = languageName(sm.lang);
    return [
      { key: "lang", header: sm.lang === "und" ? "Undetermined language" : name, noun: languageNoun(sm.lang, name), m: sm.language },
      { key: "all", header: "All languages", noun: ALL_LANGUAGES_NOUN, m: sm.all },
    ];
  }

  private metricsSection(topicId: string, scopes: Scope[]): HTMLElement {
    const def = topicById(topicId)!;
    const tm = (sc: Scope) => sc.m.topics.find((t) => t.topicId === topicId)!;
    const p = scopes[1]!.m;
    const s = h("section", { "data-testid": "fl-metrics" });
    s.append(h("p", { class: "small muted" }, `Your feed · ${periodLabel(p.current)} · catalog rule; every recorded post is in the denominator`));
    s.append(
      scopeTable(
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
    const partial = periodNotes(p.current, p.previous);
    if (partial) s.append(partial);
    for (const sc of scopes) {
      s.append(h("p", { class: "sentence", "data-testid": `fl-sentence-${sc.key}` }, interpretTopic(tm(sc), def.phrase, sc.noun)));
    }
    return s;
  }

  private whyCatalog(topicId: string, scopes: Scope[]): HTMLElement {
    const args = this.args!;
    const [langScope, allScope] = scopes as [Scope, Scope];
    const lang = this.metrics!.lang;
    const d = this.details();
    const match = args.classification.matches.find((x) => x.topicId === topicId)!;
    const def = topicById(topicId)!;
    d.append(
      h(
        "p",
        { "data-testid": "fl-post-language" },
        h("strong", {}, "Post language: "),
        `${langScope.header} (from X's own language tag). The first column only counts posts X tagged with the same language; ` +
          "the second counts every recorded post.",
      ),
    );
    d.append(h("p", {}, h("strong", {}, "Matched terms in this post: "), match.matchedTerms.join(", ")));
    d.append(h("p", {}, h("strong", {}, "Inclusion rule: "), def.rule));
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
    d.append(
      h(
        "p",
        { "data-testid": "fl-coverage" },
        h("strong", {}, "Catalog: "),
        `v${CATALOG_VERSION} recognizes ${TOPICS.length} topics (${TOPICS.map((x) => x.label).join(", ")}) by explicit rules. ` +
          "Unmatched posts still count in the denominator, so catalog shares stay honest. For any other subject, use Similar to this post.",
      ),
    );
    d.append(exposureDefinition());
    d.append(
      h(
        "p",
        { "data-testid": "fl-sample" },
        h("strong", {}, "Recorded sample: "),
        `${langScope.header}: ${langScope.m.currentTotal} posts in the last 7 days, ${langScope.m.previousTotal} in the previous 7 days. ` +
          `All languages: ${allScope.m.currentTotal} and ${allScope.m.previousTotal} ` +
          `(${this.metrics!.retainedTotal} kept in the last ${RETENTION_DAYS} days of local history).`,
      ),
    );
    const t = allScope.m.topics.find((x) => x.topicId === topicId);
    if (t) {
      for (const sc of scopes) {
        const r = sc.m.topics.find((x) => x.topicId === topicId)!.repeated;
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
}

function periodLabel(p: PeriodInfo): string {
  return `${formatPeriod(p.start, p.end)}${p.ongoing ? " (to date)" : ""}`;
}

function periodNotes(current: PeriodInfo, previous: PeriodInfo): HTMLElement | null {
  const notes = [periodNote(current, "Last 7 days"), periodNote(previous, "Previous 7 days")].filter(Boolean) as string[];
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

type Row<S> = { label: string; detail?: string; cells: (sc: S) => [string, string, string] };

/** Header row + one row per metric, one column per scope. */
function tableOf<S extends { key: ScopeKey; header: string }>(rows: Row<S>[], scopes: S[]): HTMLElement {
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

const scopeTable = (rows: Row<Scope>[], scopes: Scope[]) => tableOf(rows, scopes);
const semanticTable = (rows: Row<SemScope>[], scopes: SemScope[]) => tableOf(rows, scopes);

function analyzedOf(s: SemanticScope): string {
  return `${s.current.assessed + s.previous.assessed} of ${s.current.eligible + s.previous.eligible}`;
}

function changeCell(c: SemanticChange): [string, string] {
  switch (c.status) {
    case "none":
      return ["No comparison yet", "a period has no analyzed posts"];
    case "incomplete":
      return ["Not stated", "some posts not analyzed"];
    case "insufficient":
      return ["Not stated", `fewer than ${MIN_SAMPLE_FOR_DIRECTION} analyzed posts`];
    case "ok":
      return [`${formatPp(c.pp!)} pp`, c.direction === "flat" ? "about the same" : c.direction!];
  }
}

function exposureDefinition(): HTMLElement {
  return h(
    "p",
    {},
    h("strong", {}, "Counted as an exposure: "),
    "a text post in any language on your For you timeline with at least half of it (or half the screen height, for tall posts) " +
      "visible for one continuous second while the tab is visible. Ads, media-only posts, quoted cards and other pages are excluded. " +
      "Each post counts once per tab session.",
  );
}

function permalink(author: string | null, statusId: string): string {
  return author ? `https://x.com/${author}/status/${statusId}` : `https://x.com/i/status/${statusId}`;
}

function semanticEvidenceItem(e: EvidenceItem): HTMLElement {
  return h(
    "li",
    { "data-status-id": e.statusId },
    h(
      "div",
      { class: "meta" },
      `${e.author ? `@${e.author}` : "Unknown author"} · ${languageName(e.lang)} · seen ${formatDateTime(e.ts)} · similarity ${e.score.toFixed(2)}` +
        (e.fromExcerpt ? " · older record, excerpt only" : ""),
    ),
    h("div", {}, e.excerpt),
    h("a", { href: permalink(e.author, e.statusId), target: "_blank", rel: "noopener noreferrer" }, "Open on X"),
  );
}

function evidenceItem(e: ExposureLike): HTMLElement {
  const url = permalink(e.author, e.statusId);
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
