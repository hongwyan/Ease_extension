/**
 * Performance benchmark on the packaged release: 1,000 unique recorded posts, real inference.
 * Writes tests/semantic/PERF.md. Run with `npm run bench`.
 */
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem, type as osType } from "node:os";
import { join } from "node:path";
import { DIST, Harness, panel, scrollToPost, tall, textRow } from "../e2e/harness";

const DAY = 86_400_000;
const N = 1000;

const EN = [
  "Spent the weekend looking at apartments, rent near the city center is unreal",
  "Morning run along the river, 8 km at an easy pace",
  "Our sprint review went long again, two features slipped to next week",
  "Tried a new ramen place downtown and the broth was incredible",
  "Thinking about switching my savings into a broad index fund",
  "The flight to Lisbon got delayed three hours but the city was worth it",
  "Finally finished the online course on data visualization",
  "My dog refuses to walk in the rain, we stood at the door for ten minutes",
  "Studying for the certification exam every night this month",
  "The new phone camera is great in low light but the battery is weak",
  "Painted the kitchen cabinets green and I love how it turned out",
  "Our team shipped the migration to the new database without downtime",
];
const ZH = [
  "周末看了好几套房子，市中心的房租真的太贵了",
  "早上沿着河边跑了八公里，配速很轻松",
  "冲刺评审又开了很久，两个功能推迟到下周",
  "楼下新开的拉面店汤头特别浓",
  "在考虑把存款转到指数基金里",
  "去里斯本的航班晚点了三个小时，不过城市很美",
  "终于学完了数据可视化的网课",
  "我家狗下雨天不肯出门，在门口站了十分钟",
  "这个月每天晚上都在准备资格考试",
  "新手机夜拍很好，就是续航一般",
  "把厨房柜子刷成了绿色，效果很喜欢",
  "团队把数据库迁移到了新系统，全程没有停机",
];
const SUFFIX_EN = ["Anyone else?", "Not sure how I feel about it.", "Would do it again.", "Long day.", "Small wins.", "Thoughts?"];
const SUFFIX_ZH = ["有人一样吗？", "心情有点复杂。", "还会再来。", "好累的一天。", "小小的进步。", "大家怎么看？"];

function corpus(now: number) {
  return Array.from({ length: N }, (_, i) => {
    const zh = i % 3 === 2;
    const base = zh ? ZH[i % ZH.length]! : EN[i % EN.length]!;
    const suffix = zh ? SUFFIX_ZH[(i * 7) % SUFFIX_ZH.length]! : SUFFIX_EN[(i * 7) % SUFFIX_EN.length]!;
    const text = zh ? `${base}，第${i}天。${suffix}` : `${base} (day ${i}). ${suffix}`;
    // Spread over both comparison periods.
    return textRow(String(1890000000000000000n + BigInt(i)), `user${i % 97}`, now - ((i % 13) + 0.5) * DAY, text, zh ? "zh" : "en");
  });
}

/** Approximate memory of this Chromium instance (all its processes), Windows only. */
function chromiumMemoryMB(): { privateMB: number; workingSetMB: number } | null {
  if (process.platform !== "win32") return null;
  const out = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$p = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Ease_extension*' }; " +
        "'{0} {1}' -f (($p | Measure-Object PrivateMemorySize64 -Sum).Sum), (($p | Measure-Object WorkingSet64 -Sum).Sum)",
    ],
    { encoding: "utf8" },
  ).trim();
  const [priv, ws] = out.split(" ").map(Number);
  return { privateMB: Math.round(priv! / 1048576), workingSetMB: Math.round(ws! / 1048576) };
}

function dirSize(d: string): number {
  return readdirSync(d).reduce((s, f) => {
    const p = join(d, f);
    const st = statSync(p);
    return s + (st.isDirectory() ? dirSize(p) : st.size);
  }, 0);
}

/** Click a post's button from the page and time until the panel shell is in the DOM and painted. */
async function shellMs(page: Page, id: string): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const mo = new MutationObserver(() => {
          if (!document.querySelector("x-feed-lens-panel")) return;
          mo.disconnect();
          requestAnimationFrame(() => resolve(performance.now() - t0));
        });
        mo.observe(document.body, { childList: true });
        const host = document.querySelector(`article[data-fixture-id="${id}"] x-feed-lens-button`)!;
        (host.shadowRoot!.querySelector("button") as HTMLButtonElement).click();
      }),
    id,
  );
}

async function analysisMs(page: Page, id: string): Promise<{ wallMs: number; totalMs: number; encoded: number; cached: number; shell: number }> {
  const t0 = Date.now();
  const shell = await shellMs(page, id);
  const m = panel(page).locator('[data-testid="fl-sem-metrics"]:not(:has([data-testid="fl-sem-partial"]))');
  await m.waitFor({ state: "attached", timeout: 900_000 });
  const wallMs = Date.now() - t0;
  const r = {
    wallMs,
    shell,
    totalMs: Number(await m.getAttribute("data-total-ms")),
    encoded: Number(await m.getAttribute("data-encoded")),
    cached: Number(await m.getAttribute("data-cached")),
  };
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  return r;
}

test("1,000 unique posts: panel shell, cold and warm analysis, memory, package size", async () => {
  test.setTimeout(1_200_000);
  const h = await Harness.launch();
  try {
    const now = Date.now();
    const rows = corpus(now);
    expect(new Set(rows.map((r) => r.text)).size).toBe(N);
    await h.seed(rows, { trackingSince: now - 25 * DAY, recording: false, pauses: [], epoch: 0 });
    const QA = tall({ id: "1891000000000000001", author: "qa", text: "Rent near the city center keeps going up, thinking about moving out", lang: "en" });
    const QB = tall({ id: "1891000000000000002", author: "qb", text: "这个月每天晚上都在复习考试，好累", lang: "zh" });
    const QC = tall({ id: "1891000000000000003", author: "qc", text: "Our database migration finished without any downtime", lang: "en" });
    const page = await h.openHome({ forYou: [QA, QB, QC], topSpacer: 1500 });
    await page.waitForTimeout(1500);
    const memBefore = chromiumMemoryMB();

    await scrollToPost(page, QA.id);
    const cold = await analysisMs(page, QA.id);
    const memAfter = chromiumMemoryMB();
    expect(cold.encoded).toBe(N + 1);

    const warm: Awaited<ReturnType<typeof analysisMs>>[] = [];
    for (const q of [QB, QC, QA, QB, QC]) {
      await scrollToPost(page, q.id);
      warm.push(await analysisMs(page, q.id));
    }
    const shells = [cold.shell, ...warm.map((w) => w.shell)].sort((a, b) => a - b);
    const warmWall = warm.map((w) => w.wallMs).sort((a, b) => a - b);
    const median = (xs: number[]) => xs[Math.floor(xs.length / 2)]!;
    for (const w of warm) expect(w.encoded).toBeLessThanOrEqual(1); // only the clicked post, if new
    expect(median(shells)).toBeLessThan(200);
    expect(Math.max(...warmWall)).toBeLessThan(2000);

    // The offscreen document terminates the inference worker after 90 s without requests.
    await page.waitForTimeout(100_000);
    const memIdle = chromiumMemoryMB();

    const size = dirSize(DIST);
    const modelSize = dirSize(join(DIST, "models"));
    const ortSize = dirSize(join(DIST, "ort"));
    const cpu = cpus();
    const lines = [
      "# Semantic performance (packaged extension)",
      "",
      "Generated by `npm run bench` (tests/bench/bench.spec.ts). Real inference in the unpacked release, headless Chromium.",
      "",
      `- Machine: ${cpu[0]?.model.trim()} (${cpu.length} logical cores), ${Math.round(totalmem() / 2 ** 30)} GB RAM, ${osType()} ${release()}`,
      `- Corpus: ${N} unique recorded posts (2/3 English, 1/3 Chinese) over both comparison periods`,
      "",
      "| Measure | Result | Target |",
      "| --- | --- | --- |",
      `| Panel shell render (click → panel painted), median of ${shells.length} | ${Math.round(median(shells))} ms (max ${Math.round(shells.at(-1)!)} ms) | < 200 ms |`,
      `| Cold analysis: model load + encode ${cold.encoded} texts + score (click → result) | ${(cold.wallMs / 1000).toFixed(1)} s (${Math.round(cold.encoded / (cold.totalMs / 1000))} texts/s) | progress shown, cancellable |`,
      `| Warm analysis: all history cached, ${warm.length} clicks (click → result) | median ${Math.round(median(warmWall))} ms, max ${Math.round(warmWall.at(-1)!)} ms | < 2 s |`,
      `| Package size (dist) | ${(size / 1e6).toFixed(0)} MB (model ${(modelSize / 1e6).toFixed(0)} MB, ONNX Runtime ${(ortSize / 1e6).toFixed(0)} MB, code ${((size - modelSize - ortSize) / 1e6).toFixed(1)} MB) | — |`,
      memBefore && memAfter
        ? `| Approx. memory, all Chromium processes (private bytes): before → model loaded → 100 s idle | ${memBefore.privateMB} → ${memAfter.privateMB} → ${memIdle?.privateMB ?? "?"} MB (+${memAfter.privateMB - memBefore.privateMB} MB while loaded) | released when idle |`
        : "| Approx. memory | not measured on this platform | — |",
      "",
      `Cold run detail: service-worker total ${(cold.totalMs / 1000).toFixed(1)} s, ${cold.encoded} texts encoded, ${cold.cached} cached.`,
      `Warm runs (ms, click → result): ${warm.map((w) => `${w.wallMs} (encoded ${w.encoded})`).join(", ")}.`,
      "",
    ];
    writeFileSync(join("tests", "semantic", "PERF.md"), lines.join("\n"));
    console.log(lines.join("\n"));
  } finally {
    await h.close();
  }
});
