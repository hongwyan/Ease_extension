import { CATALOG_VERSION } from "../shared/catalog";
import { classify } from "../shared/classify";
import {
  makeExcerpt,
  validateMessage,
  type ExposureResult,
  type PanelResponse,
  type RequestMessage,
  type StatusResponse,
  type TrendResponse,
} from "../shared/messages";
import { comparisonPeriods, computeScopedMetrics } from "../shared/metrics";
import { getSettings, patchSettings } from "../shared/settings";
import { FeedStore } from "./db";
import { TrendService } from "./trend";

const store = new FeedStore();
const trends = new TrendService({
  store,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  publicLookupsEnabled: async () => (await getSettings()).publicLookups,
});

/** Settings writes are serialized so popup toggles and deletes never interleave. */
let settingsLock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = settingsLock.then(fn, fn);
  settingsLock = run.catch(() => undefined);
  return run;
}

/** IndexedDB meta is authoritative for recording + epoch; chrome.storage mirrors it for tabs. */
async function syncMirror(): Promise<void> {
  const meta = await store.getMeta();
  const s = await getSettings();
  if (s.recording !== meta.recording || s.epoch !== meta.epoch) {
    await patchSettings({ recording: meta.recording, epoch: meta.epoch });
  }
}

void locked(syncMirror);
chrome.runtime.onInstalled.addListener(() => void locked(syncMirror));
chrome.runtime.onStartup.addListener(() => void locked(syncMirror));

async function handle(msg: RequestMessage): Promise<unknown> {
  const now = Date.now();
  switch (msg.type) {
    case "exposure": {
      const cls = classify(msg.text);
      const topics = cls.matches.map((m) => m.topicId);
      const outcome = await store.recordExposure(
        {
          sessionId: msg.sessionId,
          statusId: msg.statusId,
          author: msg.author,
          ts: now,
          topics,
          excerpt: makeExcerpt(msg.text),
          catalogVersion: CATALOG_VERSION,
          lang: msg.lang,
        },
        msg.epoch,
        now,
      );
      const res: ExposureResult =
        outcome === "recorded" ? { ok: true, recorded: true, topics } : { ok: true, recorded: false, reason: outcome };
      return res;
    }
    case "panel": {
      const { previous } = comparisonPeriods(now);
      const [rows, meta] = await Promise.all([store.exposuresSince(previous.start, now), store.getMeta()]);
      const metrics = computeScopedMetrics(rows, msg.topicIds, msg.lang, now, meta.trackingSince, meta.pauses);
      const res: PanelResponse = { ok: true, metrics };
      return res;
    }
    case "trend": {
      const res: TrendResponse = { ok: true, result: await trends.lookup(msg.topicId) };
      return res;
    }
    case "status": {
      await store.prune(now);
      const [{ count, oldest }, meta, s] = await Promise.all([store.countExposures(), store.getMeta(), getSettings()]);
      const res: StatusResponse = {
        ok: true,
        retained: count,
        oldest,
        trackingSince: meta.trackingSince,
        epoch: meta.epoch,
        recording: meta.recording,
        publicLookups: s.publicLookups,
      };
      return res;
    }
    case "clear":
      return locked(async () => {
        const epoch = await store.clearAll(now);
        await patchSettings({ epoch });
        return { ok: true, epoch };
      });
    case "setSettings":
      return locked(async () => {
        if (msg.recording !== undefined) {
          const meta = await store.setRecording(msg.recording, now);
          await patchSettings({ recording: meta.recording, epoch: meta.epoch });
        }
        if (msg.publicLookups !== undefined) await patchSettings({ publicLookups: msg.publicLookups });
        return { ok: true, settings: await getSettings() };
      });
  }
}

const EXT_ORIGIN = chrome.runtime.getURL("");

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const msg = validateMessage(raw);
  if (!msg) {
    sendResponse({ ok: false, error: "invalid message" });
    return false;
  }
  const fromXTab = !!sender.tab && sender.frameId === 0 && (sender.url ?? "").startsWith("https://x.com/");
  const fromExtensionPage = (sender.url ?? "").startsWith(EXT_ORIGIN);
  const allowed =
    msg.type === "exposure"
      ? fromXTab
      : msg.type === "panel" || msg.type === "trend"
        ? fromXTab || fromExtensionPage
        : fromExtensionPage;
  if (!allowed) {
    sendResponse({ ok: false, error: "sender not allowed" });
    return false;
  }
  handle(msg).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
