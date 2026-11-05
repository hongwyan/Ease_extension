import { TOPIC_IDS } from "./catalog";
import { isLangCode } from "./language";
import type { ScopedMetrics } from "./metrics";
import type { SemanticMetrics } from "./semanticMetrics";
import type { TrendResult } from "./wiki";

/** Max characters of visible post text sent from the content script for classification. */
export const MAX_TEXT = 4000;
/** Stored excerpt length. */
export const EXCERPT_CHARS = 140;

export interface ExposureMessage {
  type: "exposure";
  sessionId: string;
  statusId: string;
  author: string | null;
  /** Visible outer-post text; classified in the service worker and stored (bounded) as local analysis text. */
  text: string;
  /** Normalized post language from X's lang attribute ("en", "ja", … "und"). */
  lang: string;
  /** Data epoch the content script last saw; stale epochs are rejected (deleted data stays deleted). */
  epoch: number;
}

export interface PanelRequest {
  type: "panel";
  topicIds: string[];
  /** The clicked post's language; metrics are returned for it and for all languages. */
  lang: string;
}

/**
 * Starts (or polls) the automatic semantic comparison for a clicked post. Idempotent per
 * requestId: repeating the same request returns the current progress or result, and after a
 * service-worker restart it resumes from cached embeddings. Never records an exposure.
 */
export interface SemanticRequest {
  type: "semantic";
  requestId: string;
  statusId: string;
  /** Visible outer-post text of the clicked post (bounded). */
  text: string;
  lang: string;
  /** Data epoch seen by the tab; a request from before a delete is refused. */
  epoch: number;
}

/** Stops a running analysis. keepPartial: return counts from what is already indexed (pending stays pending). */
export interface SemanticCancelRequest {
  type: "semanticCancel";
  requestId: string;
  keepPartial: boolean;
}

export interface EvidenceItem {
  statusId: string;
  author: string | null;
  ts: number;
  lang: string;
  excerpt: string;
  score: number;
  fromExcerpt: boolean;
}

export interface SemanticResult {
  /** ok: counts computed. empty-history: no other recorded posts in the two periods. insufficient-text: the clicked post has too little text to analyze. */
  outcome: "ok" | "empty-history" | "insufficient-text";
  /** Indexing was stopped before every eligible post was analyzed; pending counts are > 0. */
  partial: boolean;
  metrics: SemanticMetrics | null;
  evidence: EvidenceItem[];
  query: { recorded: boolean; tokens: number; chunks: number; truncated: boolean };
  /** Retained exposures, every language, last 30 days. */
  retainedTotal: number;
  model: { id: string; revision: string; license: string; threshold: number; thresholdVersion: string };
  timings: { totalMs: number; encodeMs: number; encoded: number; cached: number; cold: boolean };
}

export type SemanticErrorKind = "model-unavailable" | "inference" | "timeout" | "deleted" | "storage";

export type SemanticState =
  | { phase: "working"; stage: "loading-model" | "indexing" | "scoring"; done: number; total: number }
  | { phase: "done"; result: SemanticResult }
  | { phase: "error"; kind: SemanticErrorKind; message: string }
  | { phase: "cancelled" };

export interface SemanticResponse {
  ok: true;
  requestId: string;
  state: SemanticState;
}

export interface TrendRequest {
  type: "trend";
  topicId: string;
}

export interface StatusRequest {
  type: "status";
}

export interface ClearRequest {
  type: "clear";
}

export interface SetSettingsRequest {
  type: "setSettings";
  recording?: boolean;
  publicLookups?: boolean;
}

export type RequestMessage =
  | ExposureMessage
  | PanelRequest
  | SemanticRequest
  | SemanticCancelRequest
  | TrendRequest
  | StatusRequest
  | ClearRequest
  | SetSettingsRequest;

export type ExposureResult =
  | { ok: true; recorded: true; topics: string[] }
  | { ok: true; recorded: false; reason: "duplicate" | "paused" | "stale-epoch" }
  | { ok: false; error: string };

export interface PanelResponse {
  ok: true;
  metrics: ScopedMetrics;
}

export interface StatusResponse {
  ok: true;
  retained: number;
  oldest: number | null;
  trackingSince: number | null;
  epoch: number;
  recording: boolean;
  publicLookups: boolean;
  /** Cached text embeddings (derived data, deleted with history). */
  embeddings: number;
}

export type TrendResponse = { ok: true; result: TrendResult };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_ID = /^\d{1,25}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/** Returns a sanitized copy, or null if the message is malformed. */
export function validateMessage(raw: unknown): RequestMessage | null {
  if (!isObj(raw) || typeof raw.type !== "string") return null;
  switch (raw.type) {
    case "exposure": {
      const { sessionId, statusId, author, text, epoch, lang } = raw;
      if (typeof sessionId !== "string" || !UUID.test(sessionId)) return null;
      if (typeof statusId !== "string" || !STATUS_ID.test(statusId)) return null;
      if (author !== null && (typeof author !== "string" || !HANDLE.test(author))) return null;
      if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_TEXT) return null;
      if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return null;
      if (!isLangCode(lang)) return null;
      return { type: "exposure", sessionId, statusId, author, text, lang, epoch };
    }
    case "panel": {
      const ids = raw.topicIds;
      if (!Array.isArray(ids) || ids.length > TOPIC_IDS.length) return null;
      if (!ids.every((id) => typeof id === "string" && TOPIC_IDS.includes(id))) return null;
      if (!isLangCode(raw.lang)) return null;
      return { type: "panel", topicIds: [...new Set(ids as string[])], lang: raw.lang };
    }
    case "semantic": {
      const { requestId, statusId, text, lang, epoch } = raw;
      if (typeof requestId !== "string" || !UUID.test(requestId)) return null;
      if (typeof statusId !== "string" || !STATUS_ID.test(statusId)) return null;
      if (typeof text !== "string" || text.length > MAX_TEXT) return null;
      if (!isLangCode(lang)) return null;
      if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return null;
      return { type: "semantic", requestId, statusId, text, lang, epoch };
    }
    case "semanticCancel": {
      if (typeof raw.requestId !== "string" || !UUID.test(raw.requestId)) return null;
      if (typeof raw.keepPartial !== "boolean") return null;
      return { type: "semanticCancel", requestId: raw.requestId, keepPartial: raw.keepPartial };
    }
    case "trend": {
      if (typeof raw.topicId !== "string" || !TOPIC_IDS.includes(raw.topicId)) return null;
      return { type: "trend", topicId: raw.topicId };
    }
    case "status":
      return { type: "status" };
    case "clear":
      return { type: "clear" };
    case "setSettings": {
      const out: SetSettingsRequest = { type: "setSettings" };
      if (raw.recording !== undefined) {
        if (typeof raw.recording !== "boolean") return null;
        out.recording = raw.recording;
      }
      if (raw.publicLookups !== undefined) {
        if (typeof raw.publicLookups !== "boolean") return null;
        out.publicLookups = raw.publicLookups;
      }
      return out;
    }
    default:
      return null;
  }
}

export function makeExcerpt(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= EXCERPT_CHARS) return t;
  const cut = t.slice(0, EXCERPT_CHARS);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > EXCERPT_CHARS * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
