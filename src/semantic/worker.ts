/// <reference lib="webworker" />
/**
 * Dedicated inference worker, hosted by the offscreen document. Loads the packaged model
 * from the extension's own files only: remote model hosts, browser caches and CDN WASM
 * defaults are disabled before anything is loaded.
 */
import { env } from "@huggingface/transformers";
import { TransformersEncoder } from "./encoder";
import { RELEASE_ENCODER } from "./model";
import type { WorkerReply, WorkerRequest } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const base = new URL("./", self.location.href);
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL("models/", base).href;
env.useBrowserCache = false;
env.useWasmCache = false;
env.useFSCache = false;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = new URL("ort/", base).href;
// Extension pages are cross-origin isolated (manifest COOP/COEP), so ONNX Runtime can use
// SharedArrayBuffer threads. Without isolation it falls back to a single thread.
export const THREADS = self.crossOriginIsolated ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))) : 1;
wasm.numThreads = THREADS;
wasm.proxy = false;

let encoder: Promise<TransformersEncoder> | null = null;

function load(): { p: Promise<TransformersEncoder>; cold: boolean } {
  if (encoder) return { p: encoder, cold: false };
  encoder = TransformersEncoder.load(RELEASE_ENCODER, "wasm");
  encoder.catch(() => (encoder = null));
  return { p: encoder, cold: true };
}

/** Requests are processed one at a time, in arrival order. */
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  chain = chain.then(() => handle(req)).catch(() => undefined);
};

async function handle(req: WorkerRequest): Promise<void> {
  const t0 = performance.now();
  const reply = (r: WorkerReply, transfer: Transferable[] = []) => self.postMessage(r, transfer);
  if (req.op === "release") {
    const e = encoder;
    encoder = null;
    if (e) await (await e.catch(() => null))?.dispose();
    reply({ id: req.id, ok: true, op: "release" });
    return;
  }
  let enc: TransformersEncoder;
  let cold: boolean;
  try {
    const l = load();
    cold = l.cold;
    enc = await l.p;
  } catch (err) {
    reply({ id: req.id, ok: false, kind: "model-unavailable", error: describe(err) });
    return;
  }
  if (req.op === "init") {
    reply({ id: req.id, ok: true, op: "init", ms: performance.now() - t0, cold });
    return;
  }
  try {
    const results = await enc.embed(req.texts);
    reply(
      { id: req.id, ok: true, op: "embed", results, ms: performance.now() - t0, cold },
      results.map((r) => r.vec.buffer),
    );
  } catch (err) {
    reply({ id: req.id, ok: false, kind: "inference", error: describe(err) });
  }
}

function describe(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 300 ? `${m.slice(0, 300)}…` : m;
}
