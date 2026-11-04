/** User settings, kept in chrome.storage.local so every tab sees changes immediately. */
export interface Settings {
  /** Local recording on X. Off until the user enables it in the popup. */
  recording: boolean;
  /** Independent opt-in for Wikimedia pageview lookups. */
  publicLookups: boolean;
  /** Incremented on every "Delete data"; open tabs cancel pending timers when it changes. */
  epoch: number;
}

export const DEFAULT_SETTINGS: Settings = { recording: false, publicLookups: false, epoch: 0 };

export const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(got[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function parseSettings(value: unknown): Settings {
  return { ...DEFAULT_SETTINGS, ...((value as Partial<Settings> | undefined) ?? {}) };
}
