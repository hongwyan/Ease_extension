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
    private readonly profile: string,
  ) {}

  static async launch(): Promise<Harness> {
    const profile = mkdtempSync(join(tmpdir(), "xfl-e2e-"));
    const ctx = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const h = new Harness(ctx, new URL(sw.url()).host, profile);
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
