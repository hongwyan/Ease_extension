import { TOPIC_IDS } from "./catalog";
import type { PanelMetrics } from "./metrics";
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
  /** Visible outer-post text; classified in the service worker, only an excerpt is stored. */
  text: string;
  /** Data epoch the content script last saw; stale epochs are rejected (deleted data stays deleted). */
  epoch: number;
}

export interface PanelRequest {
  type: "panel";
  topicIds: string[];
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
  metrics: PanelMetrics;
}

export interface StatusResponse {
  ok: true;
  retained: number;
  oldest: number | null;
  trackingSince: number | null;
  epoch: number;
  recording: boolean;
  publicLookups: boolean;
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
      const { sessionId, statusId, author, text, epoch } = raw;
      if (typeof sessionId !== "string" || !UUID.test(sessionId)) return null;
      if (typeof statusId !== "string" || !STATUS_ID.test(statusId)) return null;
      if (author !== null && (typeof author !== "string" || !HANDLE.test(author))) return null;
      if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_TEXT) return null;
      if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return null;
      return { type: "exposure", sessionId, statusId, author, text, epoch };
    }
    case "panel": {
      const ids = raw.topicIds;
      if (!Array.isArray(ids) || ids.length > TOPIC_IDS.length) return null;
      if (!ids.every((id) => typeof id === "string" && TOPIC_IDS.includes(id))) return null;
      return { type: "panel", topicIds: [...new Set(ids as string[])] };
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
