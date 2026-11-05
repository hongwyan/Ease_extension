/**
 * Internal messages between the service worker, the offscreen document and its inference worker.
 * Content scripts never receive or send these.
 */

export const OFFSCREEN_TARGET = "x-feed-lens-encoder";

export interface WireEmbedding {
  /** Float32 vector, little-endian bytes, base64 (chrome.runtime messages are JSON). */
  vec: string;
  tokens: number;
  chunks: number;
  truncated: boolean;
}

export type EncoderOp =
  | { op: "init" }
  | { op: "embed"; texts: string[] }
  | { op: "release" };

export type OffscreenRequest = EncoderOp & { target: typeof OFFSCREEN_TARGET; jobId: string };

export type EncoderReply =
  | { ok: true; op: "init"; ms: number; cold: boolean }
  | { ok: true; op: "embed"; results: WireEmbedding[]; ms: number; cold: boolean }
  | { ok: true; op: "release" }
  | { ok: false; error: string; kind: "model-unavailable" | "inference" };

/** Worker <-> offscreen document messages carry a numeric id; vectors are transferred as Float32Array. */
export type WorkerRequest = EncoderOp & { id: number };
export type WorkerReply =
  | { id: number; ok: true; op: "init"; ms: number; cold: boolean }
  | { id: number; ok: true; op: "embed"; results: { vec: Float32Array; tokens: number; chunks: number; truncated: boolean }[]; ms: number; cold: boolean }
  | { id: number; ok: true; op: "release" }
  | { id: number; ok: false; error: string; kind: "model-unavailable" | "inference" };

export function encodeVec(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeVec(b64: string): Float32Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
