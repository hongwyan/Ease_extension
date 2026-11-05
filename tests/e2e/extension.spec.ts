import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { queryRange } from "../../src/shared/wiki";
import type { FixturePost } from "../fixtures/xTimeline";
import { wikiItems } from "../fixtures/wikiData";
import {
  DIST,
  Harness,
  button,
  inContentWorld,
  panel,
  scrollAway,
  scrollToPost,
  setTabHidden,
  settle,
  tall,
} from "./harness";

const SPACER = 1500; // nothing is on screen until a test scrolls to a post

const CHATGPT = tall({ id: "1855000000000000001", author: "alice", text: "ChatGPT just rewrote my whole landing page in 10 minutes" });
const UNKNOWN = tall({ id: "1855000000000000002", author: "bob", text: "Beautiful sunrise over the harbour this morning" });
const CLAUDE = tall({ id: "1855000000000000003", author: "carol", text: "Claude Code refactored our repo overnight" });
const MULTI = tall({ id: "1855000000000000004", author: "dave", text: "How I made $12,000 last month selling ChatGPT prompt packs" });
const AD = tall({ id: "1855000000000000005", author: "brand", text: "ChatGPT for teams — try it now", ad: true });
const MEDIA = tall({ id: "1855000000000000006", author: "erin", media: true });
const JAPANESE = tall({ id: "1855000000000000007", author: "fumi", text: "ChatGPT はとても便利です", lang: "ja" });
const QUOTE = tall({
  id: "1855000000000000008",
  author: "gina",
  text: "This is the thread everyone should read",
  quote: { id: "1777000000000000001", author: "quoted_hal", text: "Claude AI changed how I write code" },
});
const FOLLOWING = tall({ id: "1855000000000000101", author: "friend", text: "ChatGPT post from someone I follow" });

let h: Harness;
test.beforeEach(async () => {
  h = await Harness.launch();
});
test.afterEach(async () => {
  await h.close();
});

test("full path: enable in popup → scroll → persisted history → click Feed context → numbers", async () => {
  const popup = await h.popup();
  await expect(popup.locator("body")).toContainText("Measures how often a topic appears");
  await expect(popup.getByTestId("rec-status")).toHaveText("Recording is off");
  await expect(popup.getByTestId("pub-toggle")).not.toBeChecked();
  await popup.close();
  await h.enableRecording();

  const page = await h.openHome({ forYou: [CHATGPT, UNKNOWN, CLAUDE, MULTI, AD, MEDIA, JAPANESE], topSpacer: SPACER });

  // Buttons on every text post in any language (including the unknown-topic one), never on ads, media-only or the sidebar.
  await expect(page.locator("x-feed-lens-button")).toHaveCount(5);
  await expect(button(page, JAPANESE.id)).toHaveCount(1);
  for (const p of [AD, MEDIA]) await expect(button(page, p.id)).toHaveCount(0);
  await expect(page.locator('[data-testid="sidebarColumn"] x-feed-lens-button')).toHaveCount(0);

  for (const p of [CHATGPT, UNKNOWN, CLAUDE, MULTI, AD, MEDIA, JAPANESE]) {
    await scrollToPost(page, p.id);
    await settle(page);
  }
  await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id, UNKNOWN.id, CLAUDE.id, MULTI.id, JAPANESE.id].sort());
  const rows = await h.exposures();
  const byId = Object.fromEntries(rows.map((r) => [r.statusId, r]));
  expect(byId[CHATGPT.id]).toMatchObject({ author: "alice", topics: ["chatgpt"] });
  expect(byId[UNKNOWN.id]!.topics).toEqual([]); // unknown topic still in the denominator
  expect(byId[CLAUDE.id]!.topics).toEqual(["claude-ai"]);
  expect(byId[MULTI.id]!.topics).toEqual(["chatgpt", "ai-earnings"]);
  expect(byId[JAPANESE.id]).toMatchObject({ lang: "ja", topics: ["chatgpt"] });
  expect(byId[CHATGPT.id]!.lang).toBe("en");
  expect(new Set(rows.map((r) => r.sessionId)).size).toBe(1);
  expect(byId[CHATGPT.id]!.excerpt.length).toBeLessThanOrEqual(141);

  // Click: panel anchored to the post, numbers rendered, no navigation, no new exposure.
  await scrollToPost(page, CHATGPT.id);
  const before = (await h.exposures()).length;
  await button(page, CHATGPT.id).click();
  const pnl = panel(page);
  await expect(pnl).toBeVisible();
  await expect(pnl.getByTestId("fl-topic")).toHaveText("ChatGPT");
  // Two matches: within the post's language (English) and across all languages.
  await expect(pnl.getByTestId("fl-scope-lang")).toHaveText("English");
  await expect(pnl.getByTestId("fl-scope-all")).toHaveText("All languages");
  await expect(pnl.getByTestId("fl-share-lang")).toHaveText("50%");
  await expect(pnl.getByTestId("fl-share-lang-detail")).toHaveText("2 of 4");
  await expect(pnl.getByTestId("fl-share-all")).toHaveText("60%");
  await expect(pnl.getByTestId("fl-share-all-detail")).toHaveText("3 of 5");
  await expect(pnl.getByTestId("fl-change-lang")).toHaveText("No comparison yet");
  await expect(pnl.getByTestId("fl-change-all")).toHaveText("No comparison yet");
  await expect(pnl.getByTestId("fl-sentence-lang")).toHaveText(
    "2 of 4 recorded English posts (50%) in the last 7 days mentioned ChatGPT; no comparison yet, because no English posts were recorded in the previous 7 days.",
  );
  await expect(pnl.getByTestId("fl-sentence-all")).toHaveText(
    "3 of 5 recorded posts across all languages (60%) in the last 7 days mentioned ChatGPT; no comparison yet, because no posts across all languages were recorded in the previous 7 days.",
  );
  await expect(pnl.getByTestId("fl-repeated-lang")).toHaveText("100%");
  await expect(pnl.getByTestId("fl-repeated-lang-detail")).toHaveText("2 of 2 · 2 authors");
  await expect(pnl.getByTestId("fl-repeated-all")).toHaveText("66.7%");
  await expect(pnl.getByTestId("fl-repeated-all-detail")).toHaveText("2 of 3 · 3 authors");
  await expect(pnl.getByTestId("fl-partial")).toContainText("Last 7 days is a partial period");
  expect(await page.evaluate(() => (window as any).__fx.navigations)).toEqual([]);
  expect(page.url()).toBe("https://x.com/home");

  // Anchored next to the post's button, not covering its native actions.
  const btnBox = (await button(page, CHATGPT.id).boundingBox())!;
  const panelBox = (await pnl.boundingBox())!;
  expect(Math.abs(panelBox.y - (btnBox.y + btnBox.height))).toBeLessThan(12);
  for (const action of await page.locator(`article[data-fixture-id="${CHATGPT.id}"] [role="group"] > *`).all()) {
    const b = (await action.boundingBox())!;
    const overlap = !(btnBox.x + btnBox.width <= b.x || b.x + b.width <= btnBox.x || btnBox.y + btnBox.height <= b.y || b.y + b.height <= btnBox.y);
    expect(overlap).toBe(false);
  }

  // Why this result?
  await pnl.getByText("Why this result?").click();
  const why = pnl.getByTestId("fl-why");
  await expect(why).toContainText("Matched terms in this post: chatgpt");
  await expect(why).toContainText("Inclusion rule:");
  await expect(why.getByTestId("fl-post-language")).toContainText("Post language: English");
  await expect(pnl.getByTestId("fl-sample")).toContainText(
    "English: 4 posts in the last 7 days, 0 in the previous 7 days. All languages: 5 and 0",
  );
  const links = pnl.getByTestId("fl-evidence").locator("a");
  await expect(links).toHaveCount(3);
  const hrefs = await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.sort()).toEqual(
    [
      `https://x.com/alice/status/${CHATGPT.id}`,
      `https://x.com/dave/status/${MULTI.id}`,
      `https://x.com/fumi/status/${JAPANESE.id}`,
    ].sort(),
  );
  await expect(pnl.getByTestId("fl-evidence")).toContainText("@fumi · Japanese");

  // Escape closes and restores focus to the button.
  await page.keyboard.press("Escape");
  await expect(pnl).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("X-FEED-LENS-BUTTON");
  await expect(button(page, CHATGPT.id)).toHaveAttribute("aria-expanded", "false");

  // Keyboard: Enter on the focused button opens the panel; Escape closes it.
  await button(page, CHATGPT.id).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  // Second topic as a selectable chip.
  await scrollToPost(page, MULTI.id);
  await button(page, MULTI.id).click();
  const chips = panel(page).locator(".chip");
  await expect(chips).toHaveText(["ChatGPT", "Earning money with AI"]);
  await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByTestId("fl-share-lang-detail")).toHaveText("1 of 4");
  await expect(panel(page).getByTestId("fl-share-all-detail")).toHaveText("1 of 5");
  await expect(panel(page).getByTestId("fl-trend-status")).toContainText("No comparable public series");
  await page.keyboard.press("Escape");

  expect(await page.evaluate(() => (window as any).__fx.navigations)).toEqual([]);
  expect((await h.exposures()).length).toBe(before);
  await page.screenshot({ path: "e2e-screens/full-path-light.png" });
});

test("unknown topic: explains coverage; post still counts in the denominator", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [UNKNOWN, CHATGPT], topSpacer: SPACER });
  await scrollToPost(page, UNKNOWN.id);
  await settle(page);
  await scrollToPost(page, CHATGPT.id);
  await settle(page);
  await expect.poll(() => h.statusIds()).toHaveLength(2);
  await scrollToPost(page, UNKNOWN.id);
  await button(page, UNKNOWN.id).click();
  const pnl = panel(page);
  await expect(pnl.getByTestId("fl-topic")).toHaveText("No recognized topic");
  await expect(pnl.getByTestId("fl-total-lang")).toHaveText("2");
  await expect(pnl.getByTestId("fl-total-all")).toHaveText("2");
  await expect(pnl.getByTestId("fl-sentence-unknown")).toHaveText("This post matched no catalog topic.");
  await expect(pnl.getByTestId("fl-sentence-lang")).toContainText(
    "1 of 2 recorded English posts (50%) in the last 7 days also matched no topic",
  );
  await pnl.getByText("Why this result?").click();
  await expect(pnl.getByTestId("fl-coverage")).toContainText("recognizes 3 topics: ChatGPT, Claude AI, Earning money with AI");
  await expect(pnl.getByTestId("fl-trend")).toHaveCount(0);
});

test("cold start: empty state, and opening the panel never records an exposure", async () => {
  // Recording off: clicking cannot create a qualifying exposure.
  const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
  await scrollToPost(page, CHATGPT.id);
  await button(page, CHATGPT.id).click();
  await expect(panel(page).getByTestId("fl-empty")).toContainText("No qualifying exposures yet");
  await expect(panel(page).getByTestId("fl-recording-off")).toBeVisible();
  await expect(panel(page).getByTestId("fl-trend-status")).toContainText("Public lookups are off");
  await settle(page);
  expect(await h.exposures()).toEqual([]);
  expect(h.wikiRequests).toHaveLength(0);
});

test("recycled cards and X re-renders: no stale counts, no double counts, no duplicate buttons", async () => {
  await h.enableRecording();
  const P0 = tall({ id: "1856000000000000001", author: "pat", text: "ChatGPT tip of the day" });
  const Q = tall({ id: "1856000000000000002", author: "quinn", text: "Claude Code is fast" });
  const page = await h.openHome({ forYou: [P0], topSpacer: SPACER });
  await scrollToPost(page, P0.id);
  await page.waitForTimeout(400);
  // Same <article> element now shows a different post: P0's pending timer must be cancelled.
  await page.evaluate((q) => (window as any).__fx.recycle(0, q), Q);
  await expect.poll(() => h.statusIds(), { timeout: 4000 }).toEqual([Q.id]);
  await settle(page);
  expect(await h.statusIds()).toEqual([Q.id]);
  // Recycle back and forth: each post is stored once per session.
  await page.evaluate((p) => (window as any).__fx.recycle(0, p), P0);
  await settle(page);
  await page.evaluate((q) => (window as any).__fx.recycle(0, q), Q);
  await settle(page);
  await scrollAway(page);
  await page.waitForTimeout(300);
  await scrollToPost(page, Q.id); // backscroll
  await settle(page);
  expect(await h.statusIds()).toEqual([P0.id, Q.id].sort());
  // Re-render replaces the node: still exactly one button and no duplicate row.
  await page.evaluate(() => (window as any).__fx.rerender(0));
  await page.waitForTimeout(300);
  await expect(page.locator("x-feed-lens-button")).toHaveCount(1);
  await page.evaluate(() => (window as any).__fx.rerender(0));
  await settle(page);
  await expect(page.locator("x-feed-lens-button")).toHaveCount(1);
  expect((await h.exposures()).length).toBe(2);
});

test("duplicate delivery: duplicate cards and repeated/overlapping messages store one row", async () => {
  await h.enableRecording();
  const dup = { ...CHATGPT, height: 300 };
  const page = await h.openHome({ forYou: [dup, { ...dup }], topSpacer: SPACER });
  await scrollToPost(page, dup.id);
  await settle(page);
  await expect.poll(() => h.statusIds()).toEqual([dup.id]);

  // Fire 8 identical messages concurrently from the content script's own world.
  const results = await inContentWorld<unknown[]>(
    page,
    `(async () => {
      const r = await chrome.storage.local.get("settings");
      const msg = { type: "exposure", sessionId: crypto.randomUUID(), statusId: "1857000000000000009",
        author: "zed", text: "ChatGPT duplicate delivery", lang: "en", epoch: r.settings.epoch };
      return Promise.all(Array.from({ length: 8 }, () => chrome.runtime.sendMessage(msg)));
    })()`,
  );
  expect(results.filter((r: any) => r.recorded === true)).toHaveLength(1);
  expect(results.filter((r: any) => r.reason === "duplicate")).toHaveLength(7);
  expect((await h.exposures()).filter((r) => r.statusId === "1857000000000000009")).toHaveLength(1);
});

test("service-worker restart preserves history and deduplication", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
  await scrollToPost(page, CHATGPT.id);
  await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id]);

  // Stop the extension's worker through DevTools, as Chrome does when it suspends an idle worker.
  const ext = await h.popup();
  const cdp = await h.ctx.newCDPSession(ext);
  let status = "";
  cdp.on("ServiceWorker.workerVersionUpdated", (e) => {
    const v = (e.versions as { scriptURL: string; runningStatus: string }[]).find((x) => x.scriptURL.endsWith("/background.js"));
    if (v) status = v.runningStatus;
  });
  await cdp.send("ServiceWorker.enable");
  await expect.poll(() => status).toBe("running");
  const stopWorker = async () => {
    await cdp.send("ServiceWorker.stopAllWorkers");
    await expect.poll(() => status).toBe("stopped");
  };
  const sendFromContentScript = () =>
    inContentWorld<any>(
      page,
      `(async () => {
        const r = await chrome.storage.local.get("settings");
        return chrome.runtime.sendMessage({ type: "exposure", sessionId: "00000000-0000-4000-8000-000000000000",
          statusId: "${CHATGPT.id}", author: "alice", text: "ChatGPT", lang: "en", epoch: r.settings.epoch });
      })()`,
    );

  await stopWorker();
  expect((await h.statusIds())).toEqual([CHATGPT.id]); // history survives suspension
  expect(await sendFromContentScript()).toMatchObject({ ok: true, recorded: true }); // new session → may count again
  await expect.poll(() => status).toBe("running"); // the message woke a fresh worker
  await stopWorker();
  // Same session + status ID after another restart: deduplicated from persistent storage.
  expect(await sendFromContentScript()).toMatchObject({ ok: true, recorded: false, reason: "duplicate" });
  await stopWorker();
  // The page's own session also stays deduplicated (backscroll after restart).
  await scrollAway(page);
  await page.waitForTimeout(200);
  await scrollToPost(page, CHATGPT.id);
  await settle(page);
  expect((await h.exposures()).length).toBe(2);
  await ext.close();
  await button(page, CHATGPT.id).click();
  await expect(panel(page).getByTestId("fl-share-all-detail")).toHaveText("2 of 2");
});

test("background tab cancels a pending timer; returning restarts the dwell", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
  await scrollToPost(page, CHATGPT.id);
  await page.waitForTimeout(400);
  await setTabHidden(page, true);
  await settle(page);
  expect(await h.exposures()).toEqual([]);
  // While hidden, nothing starts either.
  await scrollAway(page);
  await scrollToPost(page, CHATGPT.id);
  await settle(page);
  expect(await h.exposures()).toEqual([]);
  await setTabHidden(page, false);
  await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id]);
});

test("For you → Following on the same URL cancels timers and excludes Following", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [CHATGPT, CLAUDE], following: [FOLLOWING], topSpacer: SPACER });
  await scrollToPost(page, CHATGPT.id);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#tab-following").click();
  expect(page.url()).toBe("https://x.com/home");
  await page.waitForTimeout(100);
  await scrollToPost(page, FOLLOWING.id);
  await settle(page);
  await settle(page);
  expect(await h.exposures()).toEqual([]);
  await expect(page.locator("x-feed-lens-button")).toHaveCount(0);
  // Back to For you: counting resumes without a reload.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#tab-foryou").click();
  await scrollToPost(page, CLAUDE.id);
  await expect.poll(() => h.statusIds()).toEqual([CLAUDE.id]);
  await expect(page.locator("x-feed-lens-button")).toHaveCount(2);
});

test("in-page route change (Home → post detail → Home) cancels and resumes without reload", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
  await scrollToPost(page, CHATGPT.id);
  await page.waitForTimeout(400);
  await page.evaluate((id) => (window as any).__fx.navigate(`/alice/status/${id}`), CHATGPT.id);
  await settle(page);
  expect(await h.exposures()).toEqual([]);
  await expect(page.locator("x-feed-lens-button")).toHaveCount(0);
  await page.evaluate(() => (window as any).__fx.navigate("/home"));
  await expect(page.locator("x-feed-lens-button")).toHaveCount(1);
  await scrollAway(page);
  await scrollToPost(page, CHATGPT.id);
  await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id]);
  expect(h.xRequests.filter((p) => p === "/home")).toHaveLength(1); // no reload happened
});

test("quoted post: outer status ID, author and text only", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [QUOTE], topSpacer: SPACER });
  await scrollToPost(page, QUOTE.id);
  await expect.poll(() => h.statusIds()).toEqual([QUOTE.id]);
  const [row] = await h.exposures();
  expect(row).toMatchObject({ statusId: QUOTE.id, author: "gina", topics: [] });
  expect(row!.excerpt).not.toContain("Claude");
  await button(page, QUOTE.id).click();
  await expect(panel(page).getByTestId("fl-topic")).toHaveText("No recognized topic");
});

test("pause while a timer is pending stops collection in the open tab; resume restarts it", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
  const popup = await h.popup();
  await scrollToPost(page, CHATGPT.id);
  await page.waitForTimeout(300);
  await popup.getByTestId("rec-toggle").click(); // Pause
  await expect(popup.getByTestId("rec-status")).toHaveText("Paused");
  await settle(page);
  expect(await h.exposures()).toEqual([]);
  await popup.getByTestId("rec-toggle").click(); // Resume
  await expect(popup.getByTestId("rec-status")).toHaveText("Recording on X");
  await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id]);
});

test("delete while a timer is pending removes everything and nothing is resurrected", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [CHATGPT, CLAUDE], topSpacer: SPACER });
  await scrollToPost(page, CHATGPT.id);
  await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id]);
  const popup = await h.popup();
  await expect(popup.getByTestId("rec-stats")).toContainText("1 eligible text post recorded");
  await scrollToPost(page, CLAUDE.id);
  await page.waitForTimeout(300);
  await popup.getByTestId("del").click();
  await popup.getByTestId("del-confirm").click();
  await expect(popup.getByTestId("del-msg")).toHaveText("All local data deleted.");
  await settle(page);
  await settle(page);
  expect(await h.exposures()).toEqual([]);
  await expect(popup.getByTestId("rec-stats")).toHaveText("No posts recorded yet.");
  await expect(popup.getByTestId("rec-status")).toHaveText("Recording on X");
  // Recording continues afresh for new views.
  await scrollAway(page);
  await page.waitForTimeout(200);
  await scrollToPost(page, CLAUDE.id);
  await expect.poll(() => h.statusIds()).toEqual([CLAUDE.id]);
});

test("seeded history 12/80 vs 3/75 renders 15%, 4% and +11 percentage points", async () => {
  const now = Date.now();
  const day = 86_400_000;
  const startToday = new Date(now).setHours(0, 0, 0, 0);
  const rows = [];
  const authors = ["a1", "a2", "a3", "a4", "a5"];
  for (let i = 0; i < 80; i++) {
    rows.push({
      sessionId: "11111111-1111-4111-8111-111111111111",
      statusId: String(1858000000000000000n + BigInt(i)),
      author: authors[i % 5]!,
      ts: startToday - 2 * day + 3600_000 + i,
      topics: i < 12 ? ["chatgpt"] : [],
      excerpt: i < 12 ? `ChatGPT seeded post ${i}` : `Other seeded post ${i}`,
    });
  }
  for (let i = 0; i < 75; i++) {
    rows.push({
      sessionId: "22222222-2222-4222-8222-222222222222",
      statusId: String(1859000000000000000n + BigInt(i)),
      author: authors[i % 5]!,
      ts: startToday - 9 * day + 3600_000 + i,
      topics: i < 3 ? ["chatgpt"] : [],
      excerpt: `seed ${i}`,
    });
  }
  await h.seed(rows, { trackingSince: now - 25 * day, recording: false, pauses: [], epoch: 0 });
  const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
  await scrollToPost(page, CHATGPT.id);
  await button(page, CHATGPT.id).click();
  const pnl = panel(page);
  // Seeded rows predate language tracking, so they count as English: both scopes agree.
  for (const sc of ["lang", "all"]) {
    await expect(pnl.getByTestId(`fl-share-${sc}`)).toHaveText("15%");
    await expect(pnl.getByTestId(`fl-share-${sc}-detail`)).toHaveText("12 of 80");
    await expect(pnl.getByTestId(`fl-prev-${sc}`)).toHaveText("4%");
    await expect(pnl.getByTestId(`fl-prev-${sc}-detail`)).toHaveText("3 of 75");
    await expect(pnl.getByTestId(`fl-change-${sc}`)).toHaveText("+11 pp");
    // 12 ChatGPT rows over 5 authors: a1 and a2 have 3 each, so the top two = 6 of 12.
    await expect(pnl.getByTestId(`fl-repeated-${sc}`)).toHaveText("50%");
    await expect(pnl.getByTestId(`fl-repeated-${sc}-detail`)).toHaveText("6 of 12 · 5 authors");
  }
  await expect(pnl.getByTestId("fl-sentence-lang")).toHaveText(
    "12 of 80 recorded English posts (15%) in the last 7 days mentioned ChatGPT, up from 3 of 75 (4%) in the previous 7 days.",
  );
  await expect(pnl.getByTestId("fl-sentence-all")).toHaveText(
    "12 of 80 recorded posts across all languages (15%) in the last 7 days mentioned ChatGPT, up from 3 of 75 (4%) in the previous 7 days.",
  );
  await expect(pnl.getByTestId("fl-partial")).toHaveCount(0);
  await pnl.getByText("Why this result?").click();
  await expect(pnl.getByTestId("fl-evidence").locator("li")).toHaveCount(3);
  await page.screenshot({ path: "e2e-screens/seeded-12-80.png" });
});

test("all languages: every text post gets a button; panel shows this language and all languages", async () => {
  await h.enableRecording();
  const JA_CHATGPT = tall({ id: "1860000000000000001", author: "kenji", text: "ChatGPTで会議の資料を作った", lang: "ja" });
  const JA_EARN = tall({ id: "1860000000000000002", author: "yuki", text: "AIで月収30万円稼いだ方法", lang: "ja" });
  const JA_OTHER = tall({ id: "1860000000000000003", author: "haru", text: "今日はいい天気ですね", lang: "ja" });
  const ES_CHATGPT = tall({ id: "1860000000000000004", author: "lucia", text: "Le pregunté a ChatGPT por la receta", lang: "es" });
  const EMOJI = tall({ id: "1860000000000000005", author: "fire", text: "🔥🔥🔥", lang: "qme" });
  const PT_BR = tall({ id: "1860000000000000006", author: "ana", text: "Ganhei R$ 2.000 de renda extra usando inteligência artificial", lang: "pt-BR" });
  const posts = [JA_CHATGPT, JA_EARN, JA_OTHER, ES_CHATGPT, EMOJI, PT_BR, CHATGPT];
  const page = await h.openHome({ forYou: posts, topSpacer: SPACER });
  await expect(page.locator("x-feed-lens-button")).toHaveCount(posts.length);
  for (const p of posts) {
    await scrollToPost(page, p.id);
    await settle(page);
  }
  await expect.poll(() => h.statusIds()).toEqual(posts.map((p) => p.id).sort());
  const byId = Object.fromEntries((await h.exposures()).map((r) => [r.statusId, r]));
  expect(byId[JA_CHATGPT.id]).toMatchObject({ lang: "ja", topics: ["chatgpt"] });
  expect(byId[JA_EARN.id]).toMatchObject({ lang: "ja", topics: ["ai-earnings"] });
  expect(byId[JA_OTHER.id]).toMatchObject({ lang: "ja", topics: [] });
  expect(byId[ES_CHATGPT.id]).toMatchObject({ lang: "es", topics: ["chatgpt"] });
  expect(byId[EMOJI.id]).toMatchObject({ lang: "und", topics: [] });
  expect(byId[PT_BR.id]).toMatchObject({ lang: "pt", topics: ["ai-earnings"] });

  // Japanese ChatGPT post: 1 of 3 Japanese posts, 3 of 7 posts in all languages.
  await scrollToPost(page, JA_CHATGPT.id);
  await button(page, JA_CHATGPT.id).click();
  let pnl = panel(page);
  await expect(pnl.getByTestId("fl-topic")).toHaveText("ChatGPT");
  await expect(pnl.getByTestId("fl-scope-lang")).toHaveText("Japanese");
  await expect(pnl.getByTestId("fl-share-lang")).toHaveText("33.3%");
  await expect(pnl.getByTestId("fl-share-lang-detail")).toHaveText("1 of 3");
  await expect(pnl.getByTestId("fl-share-all")).toHaveText("42.9%");
  await expect(pnl.getByTestId("fl-share-all-detail")).toHaveText("3 of 7");
  await expect(pnl.getByTestId("fl-sentence-lang")).toContainText("1 of 3 recorded Japanese posts (33.3%) in the last 7 days mentioned ChatGPT");
  await expect(pnl.getByTestId("fl-sentence-all")).toContainText("3 of 7 recorded posts across all languages (42.9%)");
  await pnl.getByText("Why this result?").click();
  await expect(pnl.getByTestId("fl-post-language")).toContainText("Post language: Japanese");
  await expect(pnl.getByTestId("fl-vocab-note")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Japanese earnings claim: 1 of 3 Japanese, 2 of 7 overall (with the Portuguese one).
  await scrollToPost(page, JA_EARN.id);
  await button(page, JA_EARN.id).click();
  pnl = panel(page);
  await expect(pnl.getByTestId("fl-topic")).toHaveText("Earning money with AI");
  await expect(pnl.getByTestId("fl-share-lang-detail")).toHaveText("1 of 3");
  await expect(pnl.getByTestId("fl-share-all-detail")).toHaveText("2 of 7");
  await page.keyboard.press("Escape");

  // Region subtag is grouped with its language.
  await scrollToPost(page, PT_BR.id);
  await button(page, PT_BR.id).click();
  pnl = panel(page);
  await expect(pnl.getByTestId("fl-scope-lang")).toHaveText("Portuguese");
  await expect(pnl.getByTestId("fl-share-lang-detail")).toHaveText("1 of 1");
  await page.keyboard.press("Escape");

  // Emoji-only text: undetermined language, still counted, no topic.
  await scrollToPost(page, EMOJI.id);
  await button(page, EMOJI.id).click();
  pnl = panel(page);
  await expect(pnl.getByTestId("fl-topic")).toHaveText("No recognized topic");
  await expect(pnl.getByTestId("fl-scope-lang")).toHaveText("Undetermined language");
  await expect(pnl.getByTestId("fl-total-lang")).toHaveText("1");
  await expect(pnl.getByTestId("fl-total-all")).toHaveText("7");
  await page.screenshot({ path: "e2e-screens/multilingual-emoji.png" });
  await page.keyboard.press("Escape");

  await scrollToPost(page, JA_CHATGPT.id);
  await button(page, JA_CHATGPT.id).click();
  await page.screenshot({ path: "e2e-screens/multilingual-ja.png" });
  expect(await page.evaluate(() => (window as any).__fx.navigations)).toEqual([]);
});


test.describe("public trend", () => {
  const range = queryRange(Date.now());
  const okBody = (article: string) =>
    JSON.stringify(wikiItems(article, range.start, range.end, (d) => (d > addDaysStr(range.end, -7) ? 2000 : 1000)));

  test("disabled by default: no request is made", async () => {
    await h.enableRecording();
    const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
    await scrollToPost(page, CHATGPT.id);
    await button(page, CHATGPT.id).click();
    await expect(panel(page).getByTestId("fl-trend-status")).toContainText("Public lookups are off");
    await page.waitForTimeout(500);
    expect(h.wikiRequests).toHaveLength(0);
  });

  test("enabled: shows totals, direction, article link, period and update; then serves cache offline", async () => {
    let calls = 0;
    h.wiki = async (route) => {
      calls++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: okBody("Claude_(AI)"),
      });
    };
    const popup = await h.popup();
    await popup.getByTestId("pub-toggle").check();
    await expect(popup.getByTestId("pub-toggle")).toBeChecked();
    await popup.close();
    const page = await h.openHome({ forYou: [CLAUDE], topSpacer: SPACER });
    await scrollToPost(page, CLAUDE.id);
    await button(page, CLAUDE.id).click();
    const pnl = panel(page);
    await expect(pnl.getByTestId("fl-trend-direction")).toHaveText("Up +100%");
    await expect(pnl.getByTestId("fl-trend-current")).toContainText("14,000 views");
    await expect(pnl.getByTestId("fl-trend-previous")).toContainText("7,000 views");
    await expect(pnl.getByTestId("fl-trend-updated")).toContainText("Updated");
    await expect(pnl.getByTestId("fl-trend").locator("a")).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Claude_(AI)");
    expect(h.wikiRequests).toHaveLength(1);
    const req = h.wikiRequests[0]!;
    expect(new URL(req.url).search).toBe("");
    expect(req.url).toMatch(/\/per-article\/en\.wikipedia\.org\/all-access\/user\/Claude_\(AI\)\/daily\/\d{10}\/\d{10}$/);
    expect(req.headers["api-user-agent"]).toMatch(/^XFeedLens\//);
    expect(req.headers["cookie"]).toBeUndefined();
    expect(JSON.stringify(req)).not.toContain(CLAUDE.id);
    expect(JSON.stringify(req)).not.toContain("carol");
    await page.keyboard.press("Escape");

    // Offline: the cached series is shown and no new request succeeds.
    h.wiki = (route) => route.abort("internetdisconnected");
    await button(page, CLAUDE.id).click();
    await expect(pnl.getByTestId("fl-trend-updated")).toContainText("Cached result from");
    await expect(pnl.getByTestId("fl-trend-direction")).toHaveText("Up +100%");
    expect(calls).toBe(1);
  });

  test("missing public data and slow lookups never block the personal panel", async () => {
    await h.enableRecording();
    const popup = await h.popup();
    await popup.getByTestId("pub-toggle").check();
    await popup.close();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.wiki = async (route) => {
      await gate;
      await route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
    };
    const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
    await scrollToPost(page, CHATGPT.id);
    await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id]);
    const t0 = Date.now();
    await button(page, CHATGPT.id).click();
    await expect(panel(page).getByTestId("fl-share-lang")).toHaveText("100%");
    expect(Date.now() - t0).toBeLessThan(1500);
    await expect(panel(page).getByTestId("fl-trend-status")).toHaveText("Looking up public pageviews…");
    release();
    await expect(panel(page).getByTestId("fl-trend-status")).toContainText("no pageview data");
    await expect(panel(page).getByTestId("fl-share-lang")).toHaveText("100%");
  });

  test("offline with no cache shows an error, personal numbers still render", async () => {
    await h.enableRecording();
    const popup = await h.popup();
    await popup.getByTestId("pub-toggle").check();
    await popup.close();
    const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER });
    await scrollToPost(page, CHATGPT.id);
    await expect.poll(() => h.statusIds()).toEqual([CHATGPT.id]);
    await button(page, CHATGPT.id).click();
    await expect(panel(page).getByTestId("fl-trend-status")).toContainText("Could not reach Wikimedia");
    await expect(panel(page).getByTestId("fl-share-lang")).toHaveText("100%");
  });
});

test("dark theme: panel and button follow X's Dim / Lights out background", async () => {
  await h.enableRecording();
  const page = await h.openHome({ forYou: [CHATGPT], topSpacer: SPACER, theme: "dim" });
  await scrollToPost(page, CHATGPT.id);
  await expect(page.locator("x-feed-lens-button")).toHaveAttribute("data-theme", "dark");
  await button(page, CHATGPT.id).click();
  await expect(page.locator("x-feed-lens-panel")).toHaveAttribute("data-theme", "dark");
  const bg = await panel(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(22, 24, 28)");
  await page.screenshot({ path: "e2e-screens/panel-dark.png" });
});

test("release folder: manifest at the root, scoped permissions, no fixture data", async () => {
  const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(["storage"]);
  expect(manifest.host_permissions).toEqual(["https://x.com/*"]);
  expect(manifest.content_scripts[0].matches).toEqual(["https://x.com/*"]);
  expect(manifest.content_security_policy.extension_pages).toContain("connect-src https://wikimedia.org");
  const files: string[] = [];
  const walk = (d: string) =>
    readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
  walk(DIST);
  for (const f of files) {
    expect(f).not.toMatch(/fixture|test|spec/i);
    if (/\.(js|html|json)$/.test(f)) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toContain("__fx");
      expect(text).not.toContain("1855000000000000001");
      expect(text).not.toMatch(/api\.x\.com|graphql/i);
    }
  }
});

function addDaysStr(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
