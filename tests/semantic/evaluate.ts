import { thresholdFor, type RelatedThresholds } from "../../src/semantic/model";
import { labeledPairs, type LabeledPair, type Split } from "./fixture";

/**
 * Calibration and held-out evaluation for the relatedness threshold.
 *
 * Rule: on the CALIBRATION split, choose the same-language and cross-language cutoffs
 * (cross ≤ same) that maximize recall while precision on determinate pairs stays at least
 * CALIBRATION_PRECISION (a margin above the 90% held-out target); ties go to the higher
 * cutoffs. Then report precision and recall on the HELD-OUT split only.
 */
export const CALIBRATION_PRECISION = 0.93;
export const TARGET_PRECISION = 0.9;
export const TARGET_RECALL = 0.75;

export interface ScoredPair extends LabeledPair {
  score: number;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
}

const predict = (p: ScoredPair, t: RelatedThresholds) => p.score >= thresholdFor(p.a.lang, p.b.lang, t);

export function confusion(pairs: ScoredPair[], t: RelatedThresholds): Confusion {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const p of pairs) {
    if (p.label === "ambiguous") continue;
    const predicted = predict(p, t);
    if (p.label === "related") predicted ? tp++ : fn++;
    else predicted ? fp++ : tn++;
  }
  return { tp, fp, fn, tn, precision: tp + fp > 0 ? tp / (tp + fp) : 1, recall: tp + fn > 0 ? tp / (tp + fn) : 1 };
}

export function calibrate(pairs: ScoredPair[], minPrecision = CALIBRATION_PRECISION): RelatedThresholds {
  const cal = pairs.filter((p) => p.split === "calibration" && p.label !== "ambiguous");
  const grid: number[] = [];
  for (let i = 0; i <= 240; i++) grid.push(Math.round((-0.2 + i * 0.005) * 1000) / 1000);
  let best: RelatedThresholds = { sameLanguage: 1, crossLanguage: 1 };
  let bestRecall = -1;
  for (const same of grid) {
    for (const cross of grid) {
      if (cross > same) break;
      const t = { sameLanguage: same, crossLanguage: cross };
      const c = confusion(cal, t);
      if (c.tp === 0 || c.precision < minPrecision) continue;
      if (c.recall > bestRecall || (c.recall === bestRecall && same + cross > best.sameLanguage + best.crossLanguage)) {
        best = t;
        bestRecall = c.recall;
      }
    }
  }
  return best;
}

export interface EvalReport {
  threshold: RelatedThresholds;
  calibration: Confusion;
  heldout: Confusion;
  pass: boolean;
  counts: Record<Split, { related: number; unrelated: number; ambiguous: number }>;
  byKind: Record<string, { n: number; correct: number }>;
  failures: { split: Split; label: string; kind: string; score: number; a: string; b: string; langs: string }[];
  perLanguage: Record<string, Confusion>;
  ambiguous: { a: string; b: string; score: number; predicted: boolean; note?: string }[];
}

export function evaluate(scored: ScoredPair[], threshold: RelatedThresholds = calibrate(scored)): EvalReport {
  const by = (s: Split) => scored.filter((p) => p.split === s);
  const counts = Object.fromEntries(
    (["calibration", "heldout"] as const).map((s) => [
      s,
      {
        related: by(s).filter((p) => p.label === "related").length,
        unrelated: by(s).filter((p) => p.label === "unrelated").length,
        ambiguous: by(s).filter((p) => p.label === "ambiguous").length,
      },
    ]),
  ) as EvalReport["counts"];
  const byKind: EvalReport["byKind"] = {};
  const failures: EvalReport["failures"] = [];
  for (const p of scored) {
    if (p.label === "ambiguous") continue;
    const ok = predict(p, threshold) === (p.label === "related");
    const k = `${p.label}:${p.kind.split("+")[0]}`;
    byKind[k] ??= { n: 0, correct: 0 };
    byKind[k].n++;
    if (ok) byKind[k].correct++;
    if (!ok) {
      failures.push({
        split: p.split,
        label: p.label,
        kind: p.kind,
        score: Math.round(p.score * 1000) / 1000,
        a: `${p.a.id}: ${p.a.text.slice(0, 70)}`,
        b: `${p.b.id}: ${p.b.text.slice(0, 70)}`,
        langs: [p.a.lang, p.b.lang].sort().join("-"),
      });
    }
  }
  const held = by("heldout");
  const perLanguage: Record<string, Confusion> = {};
  for (const langs of ["en-en", "zh-zh", "en-zh"]) {
    perLanguage[langs] = confusion(
      held.filter((p) => [p.a.lang, p.b.lang].sort().join("-") === langs),
      threshold,
    );
  }
  const heldout = confusion(held, threshold);
  return {
    threshold,
    calibration: confusion(by("calibration"), threshold),
    heldout,
    pass: heldout.precision >= TARGET_PRECISION && heldout.recall >= TARGET_RECALL,
    counts,
    byKind,
    failures: failures.sort((a, b) => (a.split === b.split ? b.score - a.score : a.split < b.split ? -1 : 1)),
    perLanguage,
    ambiguous: scored
      .filter((p) => p.label === "ambiguous")
      .map((p) => ({ a: p.a.id, b: p.b.id, score: Math.round(p.score * 1000) / 1000, predicted: predict(p, threshold), ...(p.note ? { note: p.note } : {}) })),
  };
}

export function scorePairs(vectors: Map<string, ArrayLike<number>>, score: (a: ArrayLike<number>, b: ArrayLike<number>) => number): ScoredPair[] {
  return labeledPairs().map((p) => ({ ...p, score: score(vectors.get(p.a.id)!, vectors.get(p.b.id)!) }));
}

export function summary(name: string, r: EvalReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const c = r.heldout;
  return (
    `${name}: thresholds same ${r.threshold.sameLanguage} / cross ${r.threshold.crossLanguage} | calibration P ${pct(r.calibration.precision)} R ${pct(r.calibration.recall)} | ` +
    `held-out P ${pct(c.precision)} R ${pct(c.recall)} (tp ${c.tp} fp ${c.fp} fn ${c.fn} tn ${c.tn}) ${r.pass ? "PASS" : "FAIL"}`
  );
}
