/**
 * Model-selection harness: encodes the fixture with a candidate model in Node
 * (onnxruntime-node, same ONNX file and the same TransformersEncoder code as the
 * extension) and reports calibration + held-out metrics.
 *
 *   node scripts/semantic-eval.mjs node [modelId ...]
 *
 * The release gate itself runs inside the packaged extension (see browser-eval.spec.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "@huggingface/transformers";
import { cosine, preprocess } from "../../src/semantic/core";
import { TransformersEncoder } from "../../src/semantic/encoder";
import { thresholdFor } from "../../src/semantic/model";
import { allTexts } from "./fixture";
import { evaluate, scorePairs, summary } from "./evaluate";
import { CANDIDATES } from "./candidates";

const root = process.cwd();
const lock = JSON.parse(readFileSync(join(root, "scripts/models.lock.json"), "utf8"));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CANDIDATES);
mkdirSync(join(root, ".cache/eval"), { recursive: true });

for (const id of ids) {
  const base = CANDIDATES[id];
  const rev = lock.models[base?.modelId ?? id]?.revision;
  if (!base || !rev) throw new Error(`unknown candidate ${id}`);
  env.allowRemoteModels = false;
  env.localModelPath = join(root, ".cache/models", rev) + "/";
  const t0 = performance.now();
  const enc = await TransformersEncoder.load({ ...base, revision: rev }, "cpu");
  const t1 = performance.now();
  const texts = allTexts();
  const embs = await enc.embed(texts.map((x) => preprocess(x.text)));
  const t2 = performance.now();
  const vectors = new Map(texts.map((x, i) => [x.id, embs[i]!.vec]));
  const report = evaluate(scorePairs(vectors, cosine));
  console.log(summary(id, report));
  const longIds = new Set(texts.filter((x) => x.tags?.includes("long")).map((x) => x.id));
  const longPairs = scorePairs(vectors, cosine).filter((p) => p.label !== "ambiguous" && (longIds.has(p.a.id) || longIds.has(p.b.id)));
  const ok = longPairs.filter((p) => (p.score >= thresholdFor(p.a.lang, p.b.lang, report.threshold)) === (p.label === "related")).length;
  console.log(`   long-post pairs correct: ${ok}/${longPairs.length}; long-post tokens: ${embs.filter((_, i) => longIds.has(texts[i]!.id)).map((e) => `${e.tokens}t/${e.chunks}c`).join(" ")}`);
  console.log(
    `   load ${(t1 - t0).toFixed(0)} ms, encode ${texts.length} texts ${(t2 - t1).toFixed(0)} ms; ` +
      `per-language held-out: ${Object.entries(report.perLanguage)
        .map(([k, c]) => `${k} P ${(c.precision * 100).toFixed(0)}% R ${(c.recall * 100).toFixed(0)}%`)
        .join(", ")}; chunked: ${embs.filter((e) => e.chunks > 1).length}, truncated: ${embs.filter((e) => e.truncated).length}`,
  );
  writeFileSync(join(root, ".cache/eval", `${id.replaceAll("/", "__")}.json`), JSON.stringify({ id, rev, report, vectors: Object.fromEntries([...vectors].map(([k, v]) => [k, [...v]])) }));
  await enc.dispose();
}
