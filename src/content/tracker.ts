import { extractPost, type PostInfo } from "./xAdapter";

export const DWELL_MS = 1000;

/** IntersectionObserver thresholds at 1 % steps so tall-card caps are detected precisely. */
const THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100);

/**
 * Visibility rule: at least half the card, capped at half the viewport height
 * for cards taller than the viewport, must be on screen.
 */
export function meetsVisibility(visibleHeight: number, cardHeight: number, viewportHeight: number): boolean {
  if (cardHeight <= 0 || viewportHeight <= 0) return false;
  const required = Math.min(cardHeight / 2, viewportHeight / 2);
  return visibleHeight + 0.5 >= required;
}

export function visibleHeightOf(el: Element, viewportHeight: number): { visible: number; height: number } {
  const r = el.getBoundingClientRect();
  const visible = Math.max(0, Math.min(r.bottom, viewportHeight) - Math.max(r.top, 0));
  return { visible, height: r.height };
}

export interface TrackerEnv {
  /** Recording on, epoch, and whether the page is the For you timeline right now. */
  canRecord(): boolean;
  isForYou(): boolean;
  epoch(): number;
  /** Persists the exposure; resolves true if it is (or already was) stored. */
  send(info: PostInfo & { statusId: string }, epoch: number): Promise<"stored" | "retry">;
}

interface CardState {
  info: PostInfo;
  timer: ReturnType<typeof setTimeout> | null;
  /** Identity/epoch the pending timer was started for. */
  pending: { statusId: string; epoch: number } | null;
}

export class ExposureTracker {
  private readonly io: IntersectionObserver;
  private readonly cards = new Map<HTMLElement, CardState>();
  /** Status IDs counted (or being counted) in this session — a fast path; the SW is authoritative. */
  private readonly counted = new Set<string>();
  readonly stats = { started: 0, cancelled: 0, sent: 0 };

  constructor(private readonly env: TrackerEnv) {
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), { threshold: THRESHOLDS });
  }

  /** Reconciles tracked cards with the posts currently in the timeline. */
  sync(posts: HTMLElement[]): void {
    const present = new Set(posts);
    for (const [el, state] of this.cards) {
      if (!present.has(el) || !el.isConnected) {
        this.cancel(state);
        this.io.unobserve(el);
        this.cards.delete(el);
      }
    }
    for (const el of posts) {
      const info = extractPost(el);
      const state = this.cards.get(el);
      if (!state) {
        this.cards.set(el, { info, timer: null, pending: null });
        this.io.observe(el);
        continue;
      }
      if (state.info.statusId !== info.statusId || state.info.eligible !== info.eligible) {
        // DOM recycling: same element, different post. Cancel and re-evaluate from scratch.
        this.cancel(state);
        state.info = info;
        this.io.unobserve(el);
        this.io.observe(el);
      } else {
        state.info = info;
      }
    }
  }

  /** Cancels every pending timer (route, tab, visibility, pause or delete changed). */
  cancelAll(): void {
    for (const state of this.cards.values()) this.cancel(state);
  }

  /** Re-observes every card so currently visible cards can start a fresh dwell. */
  rearm(): void {
    for (const el of this.cards.keys()) {
      this.io.unobserve(el);
      this.io.observe(el);
    }
  }

  /** Forget session-local counted IDs (after Delete data the SW history is empty). */
  resetCounted(): void {
    this.counted.clear();
  }

  disconnect(): void {
    this.cancelAll();
    this.io.disconnect();
    this.cards.clear();
  }

  pendingCount(): number {
    let n = 0;
    for (const s of this.cards.values()) if (s.timer) n++;
    return n;
  }

  private cancel(state: CardState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
      state.pending = null;
      this.stats.cancelled++;
    }
  }

  private eligibleNow(state: CardState): state is CardState & { info: PostInfo & { statusId: string } } {
    return (
      state.info.eligible &&
      !!state.info.statusId &&
      !this.counted.has(state.info.statusId) &&
      document.visibilityState === "visible" &&
      this.env.isForYou() &&
      this.env.canRecord()
    );
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    const vh = window.innerHeight;
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const state = this.cards.get(el);
      if (!state) continue;
      const ok =
        entry.isIntersecting && meetsVisibility(entry.intersectionRect.height, entry.boundingClientRect.height, vh);
      if (!ok) {
        this.cancel(state);
        continue;
      }
      if (state.timer || !this.eligibleNow(state)) continue;
      const pending = { statusId: state.info.statusId, epoch: this.env.epoch() };
      state.pending = pending;
      this.stats.started++;
      state.timer = setTimeout(() => this.fire(el, state, pending), DWELL_MS);
    }
  }

  private fire(el: HTMLElement, state: CardState, pending: { statusId: string; epoch: number }): void {
    state.timer = null;
    state.pending = null;
    // Recheck every condition at the moment of writing.
    if (!el.isConnected || this.cards.get(el) !== state) return;
    const fresh = extractPost(el);
    if (!fresh.eligible || fresh.statusId !== pending.statusId) return;
    if (this.env.epoch() !== pending.epoch) return;
    if (document.visibilityState !== "visible" || !this.env.isForYou() || !this.env.canRecord()) return;
    if (this.counted.has(pending.statusId)) return;
    const { visible, height } = visibleHeightOf(el, window.innerHeight);
    if (!meetsVisibility(visible, height, window.innerHeight)) return;

    const statusId = pending.statusId;
    this.counted.add(statusId);
    this.stats.sent++;
    this.env
      .send({ ...fresh, statusId }, pending.epoch)
      .then((r) => {
        if (r === "retry") this.counted.delete(statusId);
      })
      .catch(() => this.counted.delete(statusId));
  }
}
