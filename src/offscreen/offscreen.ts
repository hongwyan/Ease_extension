/**
 * Offscreen document: hosts the inference worker on behalf of the service worker
 * (service workers cannot start dedicated workers). Accepts messages only from this
 * extension's service worker and only those addressed to it. The worker, and with it the
 * model's memory, is released after IDLE_MS without requests.
 */
import {
  OFFSCREEN_TARGET,
  encodeVec,
  type EncoderOp,
  type EncoderReply,
  type OffscreenRequest,
  type WorkerReply,
  type WorkerRequest,
} from "../semantic/protocol";

const IDLE_MS = 90_000;
const SW_URL = chrome.runtime.getURL("background.js");

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: WorkerReply) => void>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(chrome.runtime.getURL("semantic-worker.js"), { type: "module", name: "x-feed-lens-encoder" });
  w.onmessage = (e: MessageEvent<WorkerReply>) => {
    const cb = pending.get(e.data.id);
    pending.delete(e.data.id);
    cb?.(e.data);
  };
  w.onerror = (e) => {
    e.preventDefault();
    failAll(`Inference worker error: ${e.message || "failed to start"}`);
  };
  worker = w;
  return w;
}

function failAll(error: string): void {
  for (const [id, cb] of pending) cb({ id, ok: false, kind: "model-unavailable", error });
  pending.clear();
  worker?.terminate();
  worker = null;
}

function call(op: EncoderOp): Promise<WorkerReply> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ ...op, id } as WorkerRequest);
  });
}

function armIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size > 0) return armIdle();
    worker?.terminate(); // frees the model and WASM memory
    worker = null;
  }, IDLE_MS);
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as Partial<OffscreenRequest> | null;
  if (!msg || msg.target !== OFFSCREEN_TARGET) return false; // not for us
  if (sender.id !== chrome.runtime.id || sender.url !== SW_URL) {
    sendResponse({ ok: false, kind: "inference", error: "sender not allowed" } satisfies EncoderReply);
    return false;
  }
  void (async () => {
    let reply: EncoderReply;
    if (msg.op === "release") {
      worker?.terminate();
      worker = null;
      reply = { ok: true, op: "release" };
    } else if (msg.op === "init" || (msg.op === "embed" && isTextList((msg as { texts?: unknown }).texts))) {
      const r = await call(msg.op === "init" ? { op: "init" } : { op: "embed", texts: (msg as { texts: string[] }).texts });
      if (!r.ok) reply = { ok: false, error: r.error, kind: r.kind };
      else if (r.op === "embed")
        reply = {
          ok: true,
          op: "embed",
          ms: r.ms,
          cold: r.cold,
          results: r.results.map((x) => ({ vec: encodeVec(x.vec), tokens: x.tokens, chunks: x.chunks, truncated: x.truncated })),
        };
      else if (r.op === "init") reply = { ok: true, op: "init", ms: r.ms, cold: r.cold };
      else reply = { ok: true, op: "release" };
    } else {
      reply = { ok: false, kind: "inference", error: "invalid request" };
    }
    armIdle();
    sendResponse(reply);
  })();
  return true;
});

function isTextList(x: unknown): x is string[] {
  return Array.isArray(x) && x.length > 0 && x.length <= 64 && x.every((t) => typeof t === "string" && t.length <= 8000);
}
