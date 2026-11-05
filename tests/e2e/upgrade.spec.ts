/**
 * Real upgrade: history recorded by the committed v0.2.0 build (IndexedDB version 1, excerpts
 * only) is opened by this release in the same profile, from the same extension folder (same
 * extension ID), exactly as "Reload" on chrome://extensions does for an unpacked extension.
 *
 * The v0.2.0 build comes from git (commit 5a65fe9) and is built on demand into .cache.
 */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DIST, Harness, button, panel, scrollToPost, semanticOutcome, settle, tall } from "./harness";

const V02_COMMIT = "5a65fe9";
const V02_SRC = resolve(".cache", "v0.2-src");
const V02_DIST = join(V02_SRC, "dist");

function buildV02(): void {
  if (existsSync(join(V02_DIST, "manifest.json"))) return;
  rmSync(V02_SRC, { recursive: true, force: true });
  mkdirSync(V02_SRC, { recursive: true });
  const tar = execFileSync("git", ["archive", "--format=tar", V02_COMMIT, "src", "static", "scripts", "package.json"]);
  execFileSync("tar", ["-x", "-C", V02_SRC], { input: tar });
  execFileSync(process.execPath, [join(V02_SRC, "scripts", "build.mjs")], { stdio: "inherit" });
}

const SPACER = 1500;
const RENT_ZH = tall({ id: "1873000000000000001", author: "mei", text: "上海房租又涨了，房东说每个月要再加800块，一居室快租不起了。", lang: "zh" });
const RENT_ZH2 = tall({ id: "1873000000000000002", author: "lin", text: "上海的房租涨得太离谱了，房东又要加钱，我可能得搬到郊区去住。", lang: "zh" });
const RENT_EN = tall({ id: "1873000000000000003", author: "sam", text: "Rent in Shanghai went up again. My landlord wants 800 more a month for my one-bedroom.", lang: "en" });
const CAT = tall({ id: "1873000000000000004", author: "yan", text: "我家猫把我的咖啡从桌上推下去，看了我一眼就走了。", lang: "zh" });
const NEW = tall({ id: "1873000000000000005", author: "neo", text: "房东又要涨房租了，上海租房的压力越来越大。", lang: "zh" });

test("v0.2 history survives the upgrade and is analyzed from excerpts, clearly labeled", async () => {
  test.setTimeout(300_000);
  buildV02();
  const extDir = mkdtempSync(join(tmpdir(), "xfl-upgrade-ext-"));
  const profile = mkdtempSync(join(tmpdir(), "xfl-upgrade-profile-"));
  try {
    // 1) v0.2.0: record four posts.
    cpSync(V02_DIST, extDir, { recursive: true });
    let h = await Harness.launch({ dist: extDir, profile });
    const oldId = h.extId;
    await h.enableRecording();
    let page = await h.openHome({ forYou: [RENT_ZH, RENT_ZH2, RENT_EN, CAT], topSpacer: SPACER });
    for (const p of [RENT_ZH, RENT_ZH2, RENT_EN, CAT]) {
      await scrollToPost(page, p.id);
      await settle(page);
    }
    await expect.poll(() => h.statusIds()).toHaveLength(4);
    const before = await h.exposures();
    expect(before.every((r) => r.text === undefined)).toBe(true); // v0.2 kept excerpts only
    await page.close();
    await h.close();

    // 2) Replace the folder with this release and start again with the same profile and folder
    //    (same extension ID → same IndexedDB). In a user's Chrome, the Reload button re-registers the
    //    service worker; automated Chromium refuses to reload command-line extensions, and a plain
    //    relaunch would keep the cached v0.2 worker script. Removing only the service-worker
    //    registration cache reproduces the re-registration; IndexedDB and settings are untouched.
    rmSync(extDir, { recursive: true, force: true });
    cpSync(DIST, extDir, { recursive: true });
    rmSync(join(profile, "Default", "Service Worker"), { recursive: true, force: true });
    h = await Harness.launch({ dist: extDir, profile });
    {
      expect(h.extId).toBe(oldId);
      const popup = await h.popup();
      expect(await popup.evaluate(() => chrome.runtime.getManifest().version)).toBe("0.3.0");
      await expect(popup.getByTestId("rec-status")).toHaveText("Recording on X"); // settings and meta preserved
      await expect(popup.getByTestId("rec-stats")).toContainText("4 eligible text posts recorded");
      await popup.close();
      const after = await h.exposures();
      expect(after.sort((a, b) => a.statusId.localeCompare(b.statusId))).toEqual(before.sort((a, b) => a.statusId.localeCompare(b.statusId)));
      expect(await h.embeddingCount()).toBe(0); // new store exists, empty

      // 3) A new post recorded by v0.3 stores analysis text; old rows are analyzed from excerpts.
      page = await h.openHome({ forYou: [NEW, RENT_ZH], topSpacer: SPACER });
      await scrollToPost(page, NEW.id);
      await expect.poll(async () => (await h.exposures()).find((r) => r.statusId === NEW.id)?.text).toBe(NEW.text);
      await scrollToPost(page, RENT_ZH.id);
      await button(page, RENT_ZH.id).click();
      const pnl = panel(page);
      expect(await semanticOutcome(page)).toBe("fl-sem-metrics");
      // Others: 3 old rows (excerpts) + the new row. The new rent post, the Chinese paraphrase and the English one match; the cat does not.
      await expect(pnl.getByTestId("fl-related-all-detail")).toHaveText("3 of 4");
      await expect(pnl.getByTestId("fl-sem-evidence")).toContainText("older record, excerpt only");
      await pnl.getByTestId("fl-why-summary").click();
      await expect(pnl.getByTestId("fl-why-excerpts")).toContainText("3 analyzed posts were recorded before full-text analysis existed");
      await expect(pnl.getByTestId("fl-why-exclusion")).toContainText("1 recorded exposure of this same post was left out");
      // Historical catalog assignments are untouched by query-specific analysis.
      const final = await h.exposures();
      for (const r of before) expect(final.find((x) => x.statusId === r.statusId)!.topics).toEqual(r.topics);
    }
    await h.close();
  } finally {
    for (const d of [extDir, profile]) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* Windows may keep files locked briefly */
      }
    }
  }
});
