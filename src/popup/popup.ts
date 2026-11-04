import { formatDayYear } from "../shared/format";
import type { StatusResponse } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const recStatus = $<HTMLParagraphElement>("rec-status");
const recStats = $<HTMLParagraphElement>("rec-stats");
const recToggle = $<HTMLButtonElement>("rec-toggle");
const pubToggle = $<HTMLInputElement>("pub-toggle");
const del = $<HTMLButtonElement>("del");
const delConfirm = $<HTMLButtonElement>("del-confirm");
const delCancel = $<HTMLButtonElement>("del-cancel");
const delMsg = $<HTMLParagraphElement>("del-msg");

let status: StatusResponse | null = null;

async function refresh(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "status" })) as StatusResponse | { ok: false };
  if (!res || !res.ok) {
    recStatus.textContent = "Could not reach the extension. Try reopening this popup.";
    return;
  }
  status = res;
  const never = !res.recording && res.trackingSince === null;
  recStatus.className = `status ${res.recording ? "on" : never ? "" : "paused"}`;
  recStatus.textContent = res.recording ? "Recording on X" : never ? "Recording is off" : "Paused";
  recToggle.textContent = res.recording ? "Pause recording" : never ? "Enable recording on X" : "Resume recording";
  recToggle.className = res.recording ? "" : "primary";
  recStats.textContent =
    res.retained === 0
      ? "No posts recorded yet."
      : `${res.retained.toLocaleString("en-US")} eligible English text post${res.retained === 1 ? "" : "s"} recorded` +
        (res.oldest ? ` since ${formatDayYear(res.oldest)}` : "") +
        " (last 30 days kept).";
  pubToggle.checked = res.publicLookups;
}

recToggle.addEventListener("click", async () => {
  recToggle.disabled = true;
  await chrome.runtime.sendMessage({ type: "setSettings", recording: !status?.recording });
  recToggle.disabled = false;
  await refresh();
});

pubToggle.addEventListener("change", async () => {
  await chrome.runtime.sendMessage({ type: "setSettings", publicLookups: pubToggle.checked });
  await refresh();
});

function confirming(on: boolean): void {
  del.hidden = on;
  delConfirm.hidden = !on;
  delCancel.hidden = !on;
  if (on) delConfirm.focus();
  else del.focus();
}

del.addEventListener("click", () => {
  delMsg.textContent = "";
  confirming(true);
});
delCancel.addEventListener("click", () => confirming(false));
delConfirm.addEventListener("click", async () => {
  delConfirm.disabled = true;
  const res = (await chrome.runtime.sendMessage({ type: "clear" })) as { ok: boolean };
  delConfirm.disabled = false;
  confirming(false);
  delMsg.textContent = res?.ok ? "All local data deleted." : "Delete failed; please try again.";
  await refresh();
});

void refresh();
