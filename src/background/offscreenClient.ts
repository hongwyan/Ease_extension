/**
 * Service-worker side of the inference path: makes sure exactly one offscreen document
 * exists (creation is serialized), then sends it requests addressed to OFFSCREEN_TARGET.
 * chrome.runtime.sendMessage from the service worker reaches extension pages only; the
 * offscreen document checks the target and that the sender is this service worker.
 */
import { OFFSCREEN_TARGET, decodeVec, type EncoderReply, type OffscreenRequest } from "../semantic/protocol";
import { EncoderFailure, type EncoderClient, type EncodedText } from "./semantic";

const OFFSCREEN_PATH = "offscreen.html";

let creating: Promise<void> | null = null;

async function hasDocument(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs the bundled multilingual text encoder in a worker, entirely on this device.",
    })
    .catch(async (e: unknown) => {
      // A concurrent creation (another service-worker instance) is fine.
      if (!(await hasDocument())) throw e;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

let seq = 0;

async function send(op: OffscreenRequest["op"], extra: { texts?: string[] }, timeoutMs: number): Promise<EncoderReply> {
  try {
    await ensureOffscreen();
  } catch (e) {
    throw new EncoderFailure("model-unavailable", `Could not start the local encoder: ${e instanceof Error ? e.message : String(e)}`);
  }
  const msg = { target: OFFSCREEN_TARGET, jobId: `j${++seq}`, op, ...extra } as OffscreenRequest;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EncoderFailure("timeout", `The local encoder did not answer within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs);
  });
  try {
    const reply = (await Promise.race([chrome.runtime.sendMessage(msg), timeout])) as EncoderReply | undefined;
    if (!reply) throw new EncoderFailure("inference", "The local encoder did not reply.");
    return reply;
  } catch (e) {
    if (e instanceof EncoderFailure) throw e;
    throw new EncoderFailure("inference", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

export const offscreenEncoder: EncoderClient = {
  async embed(texts: string[], timeoutMs: number): Promise<{ results: EncodedText[]; cold: boolean }> {
    const r = await send("embed", { texts }, timeoutMs);
    if (!r.ok) throw new EncoderFailure(r.kind, r.error);
    if (r.op !== "embed") throw new EncoderFailure("inference", "Unexpected encoder reply.");
    return {
      cold: r.cold,
      results: r.results.map((x) => ({ vec: decodeVec(x.vec), tokens: x.tokens, chunks: x.chunks, truncated: x.truncated })),
    };
  },
};

/** Frees model memory now (used after Delete data). */
export async function releaseEncoder(): Promise<void> {
  if (!(await hasDocument())) return;
  await send("release", {}, 5_000).catch(() => undefined);
}
