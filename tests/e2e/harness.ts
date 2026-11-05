import { chromium, expect, type BrowserContext, type Page, type Route, type Worker } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { timelinePage, type FixturePost, type TimelineConfig } from "../fixtures/xTimeline";

export const DIST = resolve("dist");

export interface StoredExposure {
  key: string;
  sessionId: string;
  statusId: string;
  author: string | null;
  ts: number;
  topics: string[];
  excerpt: string;
  lang?: string;
  text?: string;
  textVersion?: number;
}

export interface LaunchOptions {
  /** Extension folder to load (default: the built release, dist/). */
  dist?: string;
  /** Reuse a profile folder (upgrade tests); otherwise a fresh temporary profile. */
  profile?: string;
  args?: string[];
}

export type WikiHandler = (route: Route) => Promise<void> | void;

/**
 * Launches Chromium with the BUILT release (dist/) loaded as an unpacked extension.
 * https://x.com/* and https://wikimedia.org/* are served by request interception, so
 * the production manifest, content script and service worker run unmodified.
 */
export class Harness {
  timeline: TimelineConfig = { forYou: [] };
  wiki: WikiHandler = (r) => r.abort("internetdisconnected");
  wikiRequests: { url: string; headers: Record<string, string> }[] = [];
  xRequests: string[] = [];

  private constructor(
    readonly ctx: BrowserContext,
    readonly extId: string,
    readonly profile: string,
    private readonly keepProfile: boolean,
  ) {}

  static async launch(opts: LaunchOptions = {}): Promise<Harness> {
    const dist = opts.dist ?? DIST;
    const profile = opts.profile ?? mkdtempSync(join(tmpdir(), "xfl-e2e-"));
    const ctx = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, ...(opts.args ?? [])],
    });
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const h = new Harness(ctx, new URL(sw.url()).host, profile, !!opts.profile);
    await ctx.route("https://x.com/**", async (route) => {
      const url = new URL(route.request().url());
      h.xRequests.push(url.pathname);
      if (route.request().resourceType() === "document") {
        await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: timelinePage(h.timeline) });
      } else {
        await route.fulfill({ status: 204, body: "" });
      }
    });
    await ctx.route("https://wikimedia.org/**", async (route) => {
      h.wikiRequests.push({ url: route.request().url(), headers: route.request().headers() });
      await h.wiki(route);
    });
    // Anything else must not be contacted.
    return h;
  }

  serviceWorker(): Worker | undefined {
    return this.ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${this.extId}/`));
  }

  async close(): Promise<void> {
    await this.ctx.close();
    if (this.keepProfile) return;
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {
      /* Windows may keep files locked briefly */
    }
  }

  async popup(): Promise<Page> {
    const p = await this.ctx.newPage();
    await p.goto(`chrome-extension://${this.extId}/popup.html`);
    await expect(p.getByTestId("rec-status")).not.toHaveText("Loading…");
    return p;
  }

  async enableRecording(): Promise<void> {
    const p = await this.popup();
    await expect(p.getByTestId("rec-toggle")).toHaveText("Enable recording on X");
    await p.getByTestId("rec-toggle").click();
    await expect(p.getByTestId("rec-status")).toHaveText("Recording on X");
    await p.close();
  }

  async openHome(cfg: TimelineConfig): Promise<Page> {
    this.timeline = cfg;
    const page = await this.ctx.newPage();
    await page.goto("https://x.com/home");
    await expect(page.locator('article[data-testid="tweet"]').first()).toBeVisible();
    return page;
  }

  /** Reads IndexedDB from an extension page (same origin as the service worker). */
  async exposures(): Promise<StoredExposure[]> {
    const p = await this.ctx.newPage();
    await p.goto(`chrome-extension://${this.extId}/popup.html`);
    const rows = await p.evaluate(
      () =>
        new Promise<StoredExposure[]>((resolve, reject) => {
          const req = indexedDB.open("x-feed-lens");
          req.onsuccess = () => {
            const db = req.result;
            const t = db.transaction("exposures", "readonly");
            const g = t.objectStore("exposures").getAll();
            g.onsuccess = () => {
              resolve(g.result as StoredExposure[]);
              db.close();
            };
            g.onerror = () => reject(g.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
    await p.close();
    return rows;
  }

  async embeddingCount(): Promise<number> {
    const p = await this.ctx.newPage();
    await p.goto(`chrome-extension://${this.extId}/popup.html`);
    const n = await p.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open("x-feed-lens");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("embeddings")) {
              db.close();
              return resolve(-1);
            }
            const c = db.transaction("embeddings", "readonly").objectStore("embeddings").count();
            c.onsuccess = () => {
              resolve(c.result);
              db.close();
            };
            c.onerror = () => reject(c.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
    await p.close();
    return n;
  }

  async statusIds(): Promise<string[]> {
    return (await this.exposures()).map((r) => r.statusId).sort();
  }

  /** Writes rows + meta straight into the extension's IndexedDB (test seeding only). */
  async seed(rows: Omit<StoredExposure, "key">[], meta: Record<string, unknown>): Promise<void> {
    const p = await this.popup(); // the popup's status call makes sure the DB exists
    await p.evaluate(
      ({ rows, meta }) =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("x-feed-lens");
          req.onsuccess = () => {
            const db = req.result;
            const t = db.transaction(["exposures", "meta"], "readwrite");
            for (const r of rows) t.objectStore("exposures").put({ ...r, key: `${r.sessionId}:${r.statusId}`, catalogVersion: "seed" });
            for (const [k, v] of Object.entries(meta)) t.objectStore("meta").put({ k, v });
            t.oncomplete = () => {
              db.close();
              resolve();
            };
            t.onerror = () => reject(t.error);
          };
        }),
      { rows, meta },
    );
    await p.close();
  }
}

/** Scrolls so the given post sits near the top of the viewport (cards are tall, so neighbours stay below threshold). */
export async function scrollToPost(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const a = document.querySelector(`article[data-fixture-id="${id}"]`)!;
    const cell = a.closest('[data-testid="cellInnerDiv"]')!;
    window.scrollTo(0, cell.getBoundingClientRect().top + window.scrollY - 60);
  }, id);
}

export async function scrollAway(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

export function button(page: Page, id: string) {
  return page.locator(`article[data-fixture-id="${id}"] x-feed-lens-button button`);
}

export function panel(page: Page) {
  return page.locator("x-feed-lens-panel .panel");
}

/** Selects a view in the open panel: "semantic" or a catalog topic ID. */
export async function chooseMode(page: Page, mode: string): Promise<void> {
  const chip = panel(page).getByTestId(`fl-mode-${mode}`);
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
}

/** Waits until the semantic view leaves its progress state; returns which final state it shows. */
export async function semanticOutcome(page: Page, timeout = 120_000): Promise<string> {
  const finals = ["fl-sem-metrics", "fl-sem-empty", "fl-sem-insufficient", "fl-sem-error", "fl-sem-cancelled"];
  const sel = finals.map((t) => `[data-testid="${t}"]`).join(", ");
  const el = panel(page).locator(sel).first();
  await el.waitFor({ state: "attached", timeout });
  return (await el.getAttribute("data-testid"))!;
}

/** Seed row with v0.3 analysis text. */
export function textRow(statusId: string, author: string, ts: number, text: string, lang = "en", sessionId = "33333333-3333-4333-8333-333333333333") {
  return { sessionId, statusId, author, ts, topics: [] as string[], excerpt: text.slice(0, 140), lang, text, textVersion: 1 };
}

/**
 * Evaluates JS inside the extension content script's isolated world (via CDP).
 * Used to simulate a hidden tab: Playwright keeps every page "visible", even
 * behind another tab, so document.visibilityState is overridden in the
 * extension's own world and a real visibilitychange event is dispatched.
 */
export async function inContentWorld<T>(page: Page, expression: string): Promise<T> {
  const cdp = await page.context().newCDPSession(page);
  const contexts: { id: number; name: string; auxData?: { type?: string; isDefault?: boolean } }[] = [];
  cdp.on("Runtime.executionContextCreated", (e) => contexts.push(e.context as never));
  await cdp.send("Runtime.enable");
  const c = [...contexts].reverse().find((x) => x.name === "X Feed Lens" && x.auxData?.type === "isolated");
  if (!c) throw new Error("content-script world not found");
  const r = await cdp.send("Runtime.evaluate", { contextId: c.id, expression, awaitPromise: true, returnByValue: true });
  await cdp.detach();
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + JSON.stringify(r.exceptionDetails.exception));
  return r.result.value as T;
}

export async function setTabHidden(page: Page, hidden: boolean): Promise<void> {
  await inContentWorld(
    page,
    `Object.defineProperty(document, "visibilityState", { configurable: true, get: () => ${hidden ? '"hidden"' : '"visible"'} });
     Object.defineProperty(document, "hidden", { configurable: true, get: () => ${hidden} });
     document.dispatchEvent(new Event("visibilitychange")); true`,
  );
}

export const tall = (p: FixturePost): FixturePost => ({ height: 700, ...p });

/** Waits long enough for any pending 1-second dwell timer to have fired. */
export const settle = (page: Page) => page.waitForTimeout(1600);
