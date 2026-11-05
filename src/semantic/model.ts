import type { EncoderSpec } from "./encoder";
import { PREPROCESS_VERSION } from "./core";

/**
 * The release encoder. Files are pinned (revision + SHA-256) in scripts/models.lock.json,
 * downloaded by `npm run model:fetch`, and copied into dist/models/<modelId>/ by the build,
 * which refuses to build when they are missing or altered.
 */
export const RELEASE_ENCODER: EncoderSpec = {
  modelId: "onnx-community/gte-multilingual-base",
  revision: "2edbf5e672aab465f9ed4c154a8b61791c082c69",
  dtype: "q8",
  pooling: "cls",
  maxTokens: 96,
  maxChunks: 8,
  prefix: "",
};

/** Bump when the chunking policy changes (budget, chunk count, aggregation). */
export const CHUNKING_VERSION = 1;

/**
 * Identity of a cached embedding: model + revision + quantization + pooling + preprocessing +
 * chunking. Any change produces different cache keys, so incompatible vectors are never mixed.
 */
export function encoderKey(spec: EncoderSpec = RELEASE_ENCODER): string {
  return [
    spec.modelId,
    spec.revision.slice(0, 12),
    spec.dtype,
    spec.pooling,
    `pp${PREPROCESS_VERSION}`,
    `ch${CHUNKING_VERSION}:${spec.maxTokens}x${spec.maxChunks}`,
    spec.prefix ? `pre:${spec.prefix.trim()}` : "",
  ]
    .filter(Boolean)
    .join("|");
}

/**
 * Cosine-similarity cutoffs for "related", chosen on the calibration split of
 * tests/semantic/fixture.ts with the packaged runtime (see tests/semantic/REPORT.md).
 * Posts in different languages (X's language tags) score systematically lower for the same
 * subject, so cross-language pairs use their own calibrated cutoff. These are decision
 * boundaries, not probabilities. Versioned together with the encoder key.
 */
export interface RelatedThresholds {
  sameLanguage: number;
  crossLanguage: number;
}

export const RELATED_THRESHOLDS: RelatedThresholds = { sameLanguage: 0.67, crossLanguage: 0.6 };
export const THRESHOLD_VERSION = "2026-11-05.3";

/** Same-language cutoff only when both language tags are known and equal. */
export function thresholdFor(langA: string, langB: string, t: RelatedThresholds = RELATED_THRESHOLDS): number {
  return langA === langB && langA !== "und" ? t.sameLanguage : t.crossLanguage;
}

export function isRelated(score: number, langA: string, langB: string, t: RelatedThresholds = RELATED_THRESHOLDS): boolean {
  return score >= thresholdFor(langA, langB, t);
}
