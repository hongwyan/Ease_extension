/**
 * Release quality gate: encodes the whole fixture with the PACKAGED extension (dist/):
 * the shipped worker bundle, ONNX Runtime WASM and model files, loaded in Chromium as an
 * unpacked MV3 extension. Scores use the release threshold from src/semantic/model.ts
 * (no re-tuning here). Writes tests/semantic/REPORT.md.
 *
 *   npm run eval:semantic
 */
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cosine, preprocess } from "../../src/semantic/core";
import { RELATED_THRESHOLDS, RELEASE_ENCODER } from "../../src/semantic/model";
import { Harness } from "../e2e/harness";
import { allTexts, labeledPairs } from "./fixture";
import type { RelatedThresholds } from "../../src/semantic/model";
import { CALIBRATION_PRECISION, TARGET_PRECISION, TARGET_RECALL, calibrate, evaluate, scorePairs, type EvalReport } from "./evaluate";

test("semantic quality gate on the packaged encoder", async () => {
  test.setTimeout(600_000);
  const h = await Harness.launch();
  try {
    const page = await h.ctx.newPage();
    await page.goto(`chrome-extension://${h.extId}/offscreen.html`);
    const texts = allTexts();
    const inputs = texts.map((t) => preprocess(t.text));
    const out = await page.evaluate(async (inputs) => {
      const w = new Worker("semantic-worker.js", { type: "module" });
      let id = 0;
      const call = (msg: object) =>
        new Promise<any>((res) => {
          w.onmessage = (e) => res(e.data);
          w.postMessage({ ...msg, id: ++id });
        });
      const t0 = performance.now();
      const init = await call({ op: "init" });
      const t1 = performance.now();
      const vecs: number[][] = [];
      const meta: { tokens: number; chunks: number; truncated: boolean }[] = [];
      for (let i = 0; i < inputs.length; i += 16) {
        const r = await call({ op: "embed", texts: inputs.slice(i, i + 16) });
        if (!r.ok) return { error: r.error };
        for (const x of r.results) {
          vecs.push(Array.from(x.vec as Float32Array));
          meta.push({ tokens: x.tokens, chunks: x.chunks, truncated: x.truncated });
        }
      }
      const t2 = performance.now();
      w.terminate();
      return { init, initMs: t1 - t0, encodeMs: t2 - t1, vecs, meta, isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency };
    }, inputs);
    expect(out).not.toHaveProperty("error");
    const res = out as { isolated: boolean; cores: number; initMs: number; encodeMs: number; vecs: number[][]; meta: { tokens: number; chunks: number; truncated: boolean }[] };
    const vectors = new Map(texts.map((t, i) => [t.id, res.vecs[i]!]));
    // Packaged-runtime vectors for offline analysis (outside dist, git-ignored).
    mkdirSync(join(".cache", "eval"), { recursive: true });
    writeFileSync(join(".cache", "eval", "packaged.json"), JSON.stringify({ id: RELEASE_ENCODER.modelId, vectors: Object.fromEntries(vectors) }));
    const scored = scorePairs(vectors, cosine);
    const report = evaluate(scored, RELATED_THRESHOLDS);
    const recalibrated = calibrate(scored);
    writeFileSync(
      join("tests", "semantic", "REPORT.md"),
      renderReport(report, recalibrated, {
        texts: texts.length,
        pairs: labeledPairs().length,
        initMs: res.initMs,
        encodeMs: res.encodeMs,
        chunked: res.meta.filter((m) => m.chunks > 1).length,
        truncated: res.meta.filter((m) => m.truncated).length,
        ua: await page.evaluate(() => navigator.userAgent),
        threads: res.isolated ? Math.max(1, Math.min(4, Math.floor((res.cores || 2) / 2))) : 1,
      }),
    );
    console.log(
      `held-out precision ${(report.heldout.precision * 100).toFixed(1)}% recall ${(report.heldout.recall * 100).toFixed(1)}% ` +
        `at thresholds ${JSON.stringify(RELATED_THRESHOLDS)} (calibration rule now selects ${JSON.stringify(recalibrated)}); init ${res.initMs.toFixed(0)} ms, ` +
        `${texts.length} texts in ${res.encodeMs.toFixed(0)} ms`,
    );
    // The shipped threshold must be what the calibration rule selects on the packaged runtime.
    expect(Math.abs(recalibrated.sameLanguage - RELATED_THRESHOLDS.sameLanguage)).toBeLessThanOrEqual(0.0101);
    expect(Math.abs(recalibrated.crossLanguage - RELATED_THRESHOLDS.crossLanguage)).toBeLessThanOrEqual(0.0101);
    expect(report.heldout.precision).toBeGreaterThanOrEqual(TARGET_PRECISION);
    expect(report.heldout.recall).toBeGreaterThanOrEqual(TARGET_RECALL);
    // No network access was needed: every model/runtime file came from the extension package.
    expect(h.xRequests).toEqual([]);
    expect(h.wikiRequests).toEqual([]);
  } finally {
    await h.close();
  }
});

function renderReport(
  r: EvalReport,
  recalibrated: RelatedThresholds,
  run: { texts: number; pairs: number; initMs: number; encodeMs: number; chunked: number; truncated: number; ua: string; threads: number },
): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const row = (name: string, c: EvalReport["heldout"]) =>
    `| ${name} | ${pct(c.precision)} | ${pct(c.recall)} | ${c.tp} | ${c.fp} | ${c.fn} | ${c.tn} |`;
  const lines = [
    "# Semantic relatedness evaluation (packaged extension)",
    "",
    "Generated by `npm run eval:semantic` from `tests/semantic/fixture.ts`. Do not edit by hand.",
    "",
    `- Encoder: \`${RELEASE_ENCODER.modelId}\` @ \`${RELEASE_ENCODER.revision}\`, ${RELEASE_ENCODER.dtype}, ${RELEASE_ENCODER.pooling} pooling, ` +
      `${RELEASE_ENCODER.maxTokens}-token chunks × ${RELEASE_ENCODER.maxChunks} (mean of chunk vectors)`,
    `- Runtime: ONNX Runtime Web (WASM SIMD, ${run.threads} thread${run.threads === 1 ? "" : "s"}) inside the unpacked MV3 extension, ${run.ua}`,
    `- Release cutoffs: cosine ≥ **${r.threshold.sameLanguage}** when both posts have the same language tag, ≥ **${r.threshold.crossLanguage}** otherwise ` +
      `(calibration rule — maximum calibration recall with calibration precision ≥ ${pct(CALIBRATION_PRECISION)} — selects ${recalibrated.sameLanguage} / ${recalibrated.crossLanguage} on this runtime)`,
    `- Fixture: ${run.texts} texts, ${run.pairs} labeled pairs; ${run.chunked} texts chunked, ${run.truncated} truncated`,
    `- Encoding: model initialization ${run.initMs.toFixed(0)} ms, all texts ${run.encodeMs.toFixed(0)} ms`,
    "",
    `## Gate: held-out precision ≥ ${pct(TARGET_PRECISION)} and recall ≥ ${pct(TARGET_RECALL)} → **${r.pass ? "PASS" : "FAIL"}**`,
    "",
    "| Split | Precision | Recall | TP | FP | FN | TN |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    row("Calibration", r.calibration),
    row("Held-out", r.heldout),
    ...Object.entries(r.perLanguage).map(([k, c]) => row(`Held-out ${k}`, c)),
    "",
    `Pairs per split: calibration ${r.counts.calibration.related} related / ${r.counts.calibration.unrelated} unrelated / ${r.counts.calibration.ambiguous} ambiguous; ` +
      `held-out ${r.counts.heldout.related} / ${r.counts.heldout.unrelated} / ${r.counts.heldout.ambiguous}.`,
    "",
    "## Accuracy by pair kind (both splits)",
    "",
    "| Kind | Correct | Total |",
    "| --- | --- | --- |",
    ...Object.entries(r.byKind)
      .sort()
      .map(([k, v]) => `| ${k} | ${v.correct} | ${v.n} |`),
    "",
    "## Misclassified pairs",
    "",
    "| Split | Label | Kind | Score | Languages | A | B |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...r.failures.map((f) => `| ${f.split} | ${f.label} | ${f.kind} | ${f.score} | ${f.langs} | ${esc(f.a)} | ${esc(f.b)} |`),
    "",
    "## Ambiguous pairs (excluded from the gate)",
    "",
    "| A | B | Score | Would match | Note |",
    "| --- | --- | --- | --- | --- |",
    ...r.ambiguous.map((a) => `| ${a.a} | ${a.b} | ${a.score} | ${a.predicted ? "yes" : "no"} | ${esc(a.note ?? "")} |`),
    "",
  ];
  return lines.join("\n");
}

function esc(s: string): string {
  return s.replaceAll("|", "\\|").replaceAll("\n", " ");
}
