/**
 * Pure, runtime-independent pieces of the semantic layer. The same functions run in the
 * packaged inference worker, the service worker and the Node evaluation harness, so the
 * text that is hashed, chunked and encoded is identical everywhere.
 */

/** Bump when preprocess(), splitting or chunk aggregation changes: invalidates cached embeddings. */
export const PREPROCESS_VERSION = 1;

/** Posts with fewer content units than this cannot be assessed (emoji-only, a bare link, "ok"). */
export const MIN_CONTENT_UNITS = 2;

const URL_RE = /\bhttps?:\/\/\S+|\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|io|co|ly|me|app|dev|ai|gl|gg)\/\S*/giu;

/**
 * Canonical analysis input: Unicode NFKC, links removed (they carry no meaning once
 * shortened by X), whitespace collapsed. Mentions, hashtags and emoji are kept.
 */
export function preprocess(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(URL_RE, " ")
    .replace(/[​-‏⁠﻿]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

const NO_SPACE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Rough amount of linguistic content: one unit per CJK/Thai-type character, one per word
 * in spaced scripts. Mentions and hashtags count as one unit each at most.
 */
export function contentUnits(text: string): number {
  let units = 0;
  for (const token of text.split(/\s+/u)) {
    if (!token) continue;
    if (/^[@#]/u.test(token)) {
      units += /\p{L}/u.test(token) ? 1 : 0;
      continue;
    }
    let spacedWord = false;
    for (const ch of token) {
      if (NO_SPACE_CHAR.test(ch)) units++;
      else if (/[\p{L}\p{N}]/u.test(ch)) spacedWord = true;
    }
    if (spacedWord) units++;
  }
  return units;
}

export function isAssessable(preprocessed: string): boolean {
  return contentUnits(preprocessed) >= MIN_CONTENT_UNITS;
}

/** Splits after sentence punctuation (Latin and CJK) and line breaks, keeping the punctuation. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?。！？…\n]+(?:[.!?。！？…]+|\n|$)/gu) ?? [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}

export interface ChunkPlan {
  chunks: string[];
  /** Text beyond maxChunks × budget was not encoded. */
  truncated: boolean;
  /** Tokens (including special tokens) per chunk, as counted by the real tokenizer. */
  tokens: number[];
}

/**
 * Greedily packs whole sentences into chunks of at most `budget` tokens (special tokens included),
 * counted by the model's own tokenizer. A sentence longer than the budget is split by characters.
 * At most `maxChunks` chunks are kept; anything after that is reported as truncated.
 */
export function planChunks(text: string, countTokens: (s: string) => number, budget: number, maxChunks: number): ChunkPlan {
  const whole = countTokens(text);
  if (whole <= budget) return { chunks: [text], truncated: false, tokens: [whole] };

  const pieces: string[] = [];
  for (const s of splitSentences(text)) {
    if (countTokens(s) <= budget) {
      pieces.push(s);
      continue;
    }
    // Hard split an over-long sentence into character windows that fit.
    let rest = [...s];
    while (rest.length > 0) {
      let lo = 1;
      let hi = rest.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (countTokens(rest.slice(0, mid).join("")) <= budget) lo = mid;
        else hi = mid - 1;
      }
      pieces.push(rest.slice(0, lo).join("").trim());
      rest = rest.slice(lo);
    }
  }
  const chunks: string[] = [];
  const tokens: number[] = [];
  let cur = "";
  let truncated = false;
  for (const p of pieces.filter(Boolean)) {
    const joined = cur ? `${cur} ${p}` : p;
    const n = countTokens(joined);
    if (n <= budget) {
      cur = joined;
      continue;
    }
    if (cur) {
      chunks.push(cur);
      tokens.push(countTokens(cur));
    }
    cur = p;
    if (chunks.length >= maxChunks) {
      truncated = true;
      cur = "";
      break;
    }
  }
  if (cur && chunks.length < maxChunks) {
    chunks.push(cur);
    tokens.push(countTokens(cur));
  } else if (cur) truncated = true;
  return { chunks, truncated, tokens };
}

/** Mean pooling over the attention mask for a [batch, seq, dim] tensor. */
export function meanPool(data: Float32Array, dims: readonly number[], mask: ArrayLike<number | bigint>): Float32Array[] {
  const [batch, seq, dim] = dims as [number, number, number];
  const out: Float32Array[] = [];
  for (let b = 0; b < batch; b++) {
    const v = new Float32Array(dim);
    let n = 0;
    for (let s = 0; s < seq; s++) {
      if (Number(mask[b * seq + s]) === 0) continue;
      n++;
      const off = (b * seq + s) * dim;
      for (let d = 0; d < dim; d++) v[d]! += data[off + d]!;
    }
    if (n > 0) for (let d = 0; d < dim; d++) v[d]! /= n;
    out.push(v);
  }
  return out;
}

/** First-token ([CLS]) pooling for a [batch, seq, dim] tensor. */
export function clsPool(data: Float32Array, dims: readonly number[]): Float32Array[] {
  const [batch, seq, dim] = dims as [number, number, number];
  const out: Float32Array[] = [];
  for (let b = 0; b < batch; b++) out.push(data.slice(b * seq * dim, b * seq * dim + dim));
  return out;
}

export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/** Chunk aggregation: mean of the unit chunk vectors, renormalized. */
export function aggregate(chunkVecs: Float32Array[]): Float32Array {
  if (chunkVecs.length === 1) return chunkVecs[0]!;
  const dim = chunkVecs[0]!.length;
  const v = new Float32Array(dim);
  for (const c of chunkVecs) for (let i = 0; i < dim; i++) v[i]! += c[i]!;
  return l2normalize(v);
}

/** Dot product of unit vectors = cosine similarity. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
