/**
 * "Similar to this post" end to end, with REAL packaged inference (dist/ model, ONNX Runtime
 * WASM, offscreen document + worker). Failure modes use modified copies of the release folder.
 */
import { expect, test } from "@playwright/test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DIST,
  Harness,
  button,
  chooseMode,
  panel,
  scrollToPost,
  semanticOutcome,
  settle,
  tall,
  textRow,
} from "./harness";

const SPACER = 1500;
const DAY = 86_400_000;

// Scores with the release encoder (see tests/semantic): Q↔R1 ≈ 0.87, Q↔R2 ≈ 0.88; Q↔U* ≤ 0.53.
const Q = tall({ id: "1870000000000000001", author: "mei", text: "上海房租又涨了，房东说每个月要再加800块，一居室快租不起了。", lang: "zh" });
const R1 = tall({ id: "1870000000000000002", author: "lin", text: "上海的房租涨得太离谱了，房东又要加钱，我可能得搬到郊区去住。", lang: "zh" });
const R2 = tall({ id: "1870000000000000003", author: "sam", text: "Rent in Shanghai went up again. My landlord wants 800 more a month for my one-bedroom.", lang: "en" });
const U1 = tall({ id: "1870000000000000004", author: "wei", text: "今天在健身房练腿，深蹲100公斤，终于破了个人纪录。", lang: "zh" });
const U2 = tall({ id: "1870000000000000005", author: "yan", text: "我家猫把我的咖啡从桌上推下去，看了我一眼就走了。", lang: "zh" });
// B↔B1 ≈ 0.77, B↔B2 ≈ 0.69 (same-language cutoff 0.635).
const B = tall({ id: "1870000000000000006", author: "dev", text: "Week two of learning Rust. The borrow checker and I are not friends yet.", lang: "en" });

const FILLER_EN = [
  "Tried a new pasta recipe tonight and it was great",
  "Traffic on the bridge was terrible this morning",
  "Finished reading a mystery novel over the weekend",
  "The new season of my favourite show starts next week",
  "Planted tomatoes and basil on the balcony",
  "Our team won the pub quiz on Thursday",
];
// Note: a filler like "the noodle shop downstairs raised prices again" scores ≈ 0.70 against the rent
// post (shared "prices going up" concept) — a known limitation documented in README, kept out of these fixtures.
const FILLER_ZH = ["今天的晚霞特别好看", "周末去爬山了，风景不错", "新买的耳机音质很好", "楼下新开了一家花店", "最近在追一部悬疑剧", "下雨天适合在家看书"];

/** n unique history rows with v0.3 text in the current period (no rent and no Rust posts among them). */
function filler(n: number, now: number) {
  return Array.from({ length: n }, (_, i) => {
    const zh = i % 2 === 1;
    const base = (zh ? FILLER_ZH[i % FILLER_ZH.length] : FILLER_EN[i % FILLER_EN.length]) as string;
    return textRow(String(1880000000000000000n + BigInt(i)), `f${i % 9}`, now - (1 + (i % 5)) * DAY / 2 - i * 1000, `${base} (${i})`, zh ? "zh" : "en");
  });
}

let h: Harness;
test.beforeEach(async () => {
  h = await Harness.launch();
});
test.afterEach(async () => {
  await h.close();
});

test("Chinese paraphrases outside the catalog, a cross-language match and unrelated Chinese posts", async () => {
  test.setTimeout(120_000);
  await h.enableRecording();
  const posts = [Q, R1, R2, U1, U2];
  const page = await h.openHome({ forYou: posts, topSpacer: SPACER });
  for (const p of posts) {
    await scrollToPost(page, p.id);
    await settle(page);
  }
  await expect.poll(() => h.statusIds()).toEqual(posts.map((p) => p.id).sort());
  const stored = await h.exposures();
  expect(stored.find((r) => r.statusId === Q.id)).toMatchObject({ text: Q.text, textVersion: 1, topics: [] });

  await scrollToPost(page, Q.id);
  const before = (await h.exposures()).length;
  await button(page, Q.id).click();
  const pnl = panel(page);
  await expect(pnl.locator(".chip")).toHaveText(["Similar to this post"]); // nothing in the catalog
  expect(await semanticOutcome(page)).toBe("fl-sem-metrics");
  await expect(pnl.getByTestId("fl-scope-lang")).toHaveText("Chinese");
  // All languages: the Chinese paraphrase and the English translation, not gym or cat posts.
  await expect(pnl.getByTestId("fl-related-all")).toHaveText("50%");
  await expect(pnl.getByTestId("fl-related-all-detail")).toHaveText("2 of 4");
  await expect(pnl.getByTestId("fl-related-lang")).toHaveText("33.3%");
  await expect(pnl.getByTestId("fl-related-lang-detail")).toHaveText("1 of 3");
  await expect(pnl.getByTestId("fl-sem-sentence-lang")).toContainText("1 of 3 analyzed other Chinese posts (33.3%) in the last 7 days looked related to this post");
  await expect(pnl.getByTestId("fl-rchange-all")).toHaveText("No comparison yet");
  const links = pnl.getByTestId("fl-sem-evidence").locator("a");
  await expect(links).toHaveCount(2);
  expect((await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))).sort()).toEqual(
    [`https://x.com/lin/status/${R1.id}`, `https://x.com/sam/status/${R2.id}`].sort(),
  );
  await expect(pnl.getByTestId("fl-sem-evidence")).toContainText("@sam · English");
  await pnl.getByTestId("fl-why-summary").click();
  await expect(pnl.getByTestId("fl-why-exclusion")).toContainText("1 recorded exposure of this same post was left out");
  await expect(pnl.getByTestId("fl-why-excerpts")).toContainText("none; every analyzed post was compared using its stored visible text");
  await expect(pnl.getByTestId("fl-why-model")).toContainText("gte-multilingual-base");
  await page.screenshot({ path: "e2e-screens/semantic-zh.png" });
  await page.keyboard.press("Escape");
  await expect(pnl).toHaveCount(0);

  // An unrelated Chinese post: explicit no-match state.
  await scrollToPost(page, U1.id);
  await button(page, U1.id).click();
  expect(await semanticOutcome(page)).toBe("fl-sem-metrics");
  await expect(panel(page).getByTestId("fl-sem-nomatch")).toBeVisible();
  await expect(panel(page).getByTestId("fl-related-all-detail")).toHaveText("0 of 4");
  // Analysis never records exposures, and the second analysis was served from the cache.
  expect((await h.exposures()).length).toBe(before);
  expect(Number(await panel(page).getByTestId("fl-sem-metrics").getAttribute("data-encoded"))).toBe(0);
  expect(await h.embeddingCount()).toBe(5);
});

test("unrecorded clicked post, repeated clicks on different posts: the latest post's result always wins", async () => {
  test.setTimeout(180_000);
  const now = Date.now();
  const rows = [
    ...filler(120, now),
    textRow("1871000000000000001", "lin", now - DAY, R1.text!, "zh"),
    textRow("1871000000000000002", "rusty", now - DAY, "学Rust第二周，生命周期和所有权把我彻底搞晕了。", "zh"),
    textRow("1871000000000000003", "cli", now - DAY, "Rewrote our CLI in Rust and startup dropped from 300 ms to 8 ms.", "en"),
  ];
  await h.seed(rows, { trackingSince: now - 20 * DAY, recording: false, pauses: [], epoch: 0 });
  // Recording is off: neither post is recorded; both are compared with history only.
  const page = await h.openHome({ forYou: [Q, B], topSpacer: SPACER });
  await scrollToPost(page, Q.id);
  await button(page, Q.id).click();
  await expect(panel(page).getByTestId("fl-post-excerpt")).toContainText("上海房租又涨了");
  // Immediately switch to another post while the first analysis is still running (cold model, 124 texts).
  await scrollToPost(page, B.id);
  await button(page, B.id).click();
  const pnl = panel(page);
  await expect(pnl.getByTestId("fl-post-excerpt")).toContainText("Week two of learning Rust");
  expect(await semanticOutcome(page, 170_000)).toBe("fl-sem-metrics");
  // B's result: the two Rust posts, never Q's rent post.
  const hrefs = await pnl.getByTestId("fl-sem-evidence").locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.sort()).toEqual(["https://x.com/cli/status/1871000000000000003", "https://x.com/rusty/status/1871000000000000002"]);
  await expect(pnl.getByTestId("fl-related-all-detail")).toHaveText("2 of 123");
  await expect(pnl.getByTestId("fl-post-excerpt")).toContainText("Week two of learning Rust");
  await pnl.getByTestId("fl-why-summary").click();
  await expect(pnl.getByTestId("fl-why-exclusion")).toContainText("this post is not in your recorded history");
  // Back to Q: served from the cache, Q's own result.
  await page.keyboard.press("Escape");
  await scrollToPost(page, Q.id);
  await button(page, Q.id).click();
  expect(await semanticOutcome(page)).toBe("fl-sem-metrics");
  await expect(panel(page).getByTestId("fl-sem-evidence").locator("a")).toHaveAttribute("href", `https://x.com/lin/status/1871000000000000001`);
  expect(await h.exposures()).toHaveLength(rows.length); // nothing new recorded
});

test("Stop keeps a partial result (pending is not unrelated); closing mid-analysis and reopening works; route change closes", async () => {
  test.setTimeout(180_000);
  const now = Date.now();
  await h.seed([...filler(160, now), textRow("1871000000000000009", "lin", now - DAY, R1.text!, "zh")], {
    trackingSince: now - 20 * DAY,
    recording: false,
    pauses: [],
    epoch: 0,
  });
  const page = await h.openHome({ forYou: [Q], topSpacer: SPACER });
  await scrollToPost(page, Q.id);
  // Close while the analysis runs, then reopen: a fresh request, no stale result.
  await button(page, Q.id).click();
  await expect(panel(page).getByTestId("fl-sem-progress")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await button(page, Q.id).click();
  const pnl = panel(page);
  await expect(pnl.getByTestId("fl-sem-stop")).toBeVisible({ timeout: 60_000 });
  await pnl.getByTestId("fl-sem-stop").focus();
  await page.keyboard.press("Enter"); // keyboard operable
  expect(await semanticOutcome(page)).toBe("fl-sem-metrics");
  await expect(pnl.getByTestId("fl-sem-partial")).toContainText("were not analyzed yet and are not counted as unrelated");
  const detail = await pnl.getByTestId("fl-analyzed-all-detail").textContent();
  expect(detail).toMatch(/pending/);
  await expect(pnl.getByTestId("fl-rchange-all")).not.toContainText("pp");
  // Finish the remaining work.
  await pnl.getByTestId("fl-sem-continue").click();
  expect(await semanticOutcome(page, 170_000)).toBe("fl-sem-metrics");
  await expect(pnl.getByTestId("fl-sem-partial")).toHaveCount(0, { timeout: 170_000 });
  await expect(pnl.getByTestId("fl-analyzed-all-detail")).toHaveText("161 analyzed (100%)");
  await expect(pnl.getByTestId("fl-related-all-detail")).toHaveText("1 of 161");
  // An in-page route change closes the panel.
  await page.evaluate(() => (window as any).__fx.navigate("/mei/status/1870000000000000001"));
  await expect(panel(page)).toHaveCount(0);
});

test("delete during analysis: running work is discarded, vectors are not resurrected, the panel recomputes", async () => {
  test.setTimeout(180_000);
  const now = Date.now();
  await h.seed(filler(200, now), { trackingSince: now - 20 * DAY, recording: true, pauses: [], epoch: 0 });
  const page = await h.openHome({ forYou: [Q], topSpacer: SPACER });
  await scrollToPost(page, Q.id);
  await button(page, Q.id).click();
  await expect(panel(page).getByTestId("fl-sem-stop")).toBeVisible({ timeout: 60_000 });
  const popup = await h.popup();
  await popup.getByTestId("del").click();
  await popup.getByTestId("del-confirm").click();
  await expect(popup.getByTestId("del-msg")).toHaveText("All local data deleted.");
  // The open panel drops the old analysis and recomputes on what is left (this post only).
  expect(await semanticOutcome(page)).toBe("fl-sem-empty");
  await page.waitForTimeout(3000);
  expect(await h.embeddingCount()).toBe(0);
  expect((await h.exposures()).filter((r) => r.statusId !== Q.id)).toEqual([]);
  await popup.close();
});

test("service-worker restart during analysis resumes from cached vectors", async () => {
  test.setTimeout(180_000);
  const now = Date.now();
  await h.seed(filler(150, now), { trackingSince: now - 20 * DAY, recording: false, pauses: [], epoch: 0 });
  const page = await h.openHome({ forYou: [Q], topSpacer: SPACER });
  await scrollToPost(page, Q.id);
  await button(page, Q.id).click();
  const pnl = panel(page);
  await expect(pnl.getByTestId("fl-sem-progress")).toContainText(/Analyzing your recorded posts: [1-9]/, { timeout: 60_000 });
  const ext = await h.popup();
  const cdp = await h.ctx.newCDPSession(ext);
  let status = "";
  let stops = 0;
  cdp.on("ServiceWorker.workerVersionUpdated", (e) => {
    const v = (e.versions as { scriptURL: string; runningStatus: string }[]).find((x) => x.scriptURL.endsWith("/background.js"));
    if (v) {
      if (v.runningStatus === "stopped" && status !== "stopped") stops++;
      status = v.runningStatus;
    }
  });
  await cdp.send("ServiceWorker.enable");
  await expect.poll(() => status).toBe("running");
  const cachedBefore = await h.embeddingCount();
  expect(cachedBefore).toBeGreaterThan(0);
  await cdp.send("ServiceWorker.stopAllWorkers");
  // The panel keeps polling, so a fresh worker starts right after the stop.
  await expect.poll(() => stops).toBeGreaterThan(0);
  // The panel's next poll wakes a fresh worker, which rebuilds the job from durable state.
  expect(await semanticOutcome(page, 170_000)).toBe("fl-sem-metrics");
  await expect(pnl.getByTestId("fl-analyzed-all-detail")).toHaveText("150 analyzed (100%)");
  expect(Number(await pnl.getByTestId("fl-sem-metrics").getAttribute("data-cached"))).toBeGreaterThanOrEqual(cachedBefore);
  expect(await h.embeddingCount()).toBe(150);
  await ext.close();
});

test("two X tabs analyzing at once share one model instance and agree", async () => {
  test.setTimeout(180_000);
  const now = Date.now();
  await h.seed([...filler(80, now), textRow("1871000000000000021", "lin", now - DAY, R1.text!, "zh")], {
    trackingSince: now - 20 * DAY,
    recording: false,
    pauses: [],
    epoch: 0,
  });
  const a = await h.openHome({ forYou: [Q], topSpacer: SPACER });
  const b = await h.openHome({ forYou: [Q], topSpacer: SPACER });
  await scrollToPost(a, Q.id);
  await scrollToPost(b, Q.id);
  await Promise.all([button(a, Q.id).click(), button(b, Q.id).click()]);
  expect(await semanticOutcome(a)).toBe("fl-sem-metrics");
  expect(await semanticOutcome(b)).toBe("fl-sem-metrics");
  for (const p of [a, b]) await expect(panel(p).getByTestId("fl-related-all-detail")).toHaveText("1 of 81");
  const contexts = await h.serviceWorker()!.evaluate(async () =>
    (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length,
  );
  expect(contexts).toBe(1);
  expect(await h.embeddingCount()).toBe(81); // each history text stored once
});

test.describe("failure states (modified copies of the release)", () => {
  let dir: string;
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function launchBroken(mutate: (dist: string) => void): Promise<Harness> {
    await h.close();
    dir = mkdtempSync(join(tmpdir(), "xfl-broken-"));
    cpSync(DIST, dir, { recursive: true });
    mutate(dir);
    h = await Harness.launch({ dist: dir });
    return h;
  }

  for (const c of [
    {
      name: "missing model weights",
      mutate: (d: string) => rmSync(join(d, "models/onnx-community/gte-multilingual-base/onnx/model_quantized.onnx")),
      kind: "could not be loaded",
    },
    {
      name: "corrupt ONNX Runtime WASM",
      mutate: (d: string) => writeFileSync(join(d, "ort/ort-wasm-simd-threaded.wasm"), "not wasm"),
      kind: "could not be loaded",
    },
  ]) {
    test(`${c.name}: an error state with retry, never a zero-match result; catalog view still works`, async () => {
      test.setTimeout(120_000);
      await launchBroken(c.mutate);
      await h.enableRecording();
      const CHATGPT = tall({ id: "1872000000000000001", author: "alice", text: "ChatGPT just rewrote my whole landing page in 10 minutes" });
      const OTHER = tall({ id: "1872000000000000002", author: "bob", text: "ChatGPT helped me plan meals for the week" });
      const page = await h.openHome({ forYou: [CHATGPT, OTHER], topSpacer: SPACER });
      for (const p of [CHATGPT, OTHER]) {
        await scrollToPost(page, p.id);
        await settle(page);
      }
      await expect.poll(() => h.statusIds()).toHaveLength(2);
      await button(page, OTHER.id).click();
      const pnl = panel(page);
      expect(await semanticOutcome(page)).toBe("fl-sem-error");
      await expect(pnl.getByTestId("fl-sem-error")).toContainText(c.kind);
      await expect(pnl.getByTestId("fl-sem-error")).toContainText("This is not a result");
      await expect(pnl.getByTestId("fl-related-all")).toHaveCount(0);
      await expect(pnl.getByTestId("fl-sem-nomatch")).toHaveCount(0);
      await pnl.getByTestId("fl-sem-retry").click();
      expect(await semanticOutcome(page)).toBe("fl-sem-error");
      await chooseMode(page, "chatgpt");
      await expect(pnl.getByTestId("fl-share-all-detail")).toHaveText("2 of 2");
    });
  }
});
