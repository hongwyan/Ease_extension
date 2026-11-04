import { addLocalDays, round1 } from "./metrics";

/** 15 → "15%", 4 → "4%", 3.333 → "3.3%". */
export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  return `${trimNumber(round1(pct))}%`;
}

/** 11 → "+11", -2.5 → "−2.5", 0 → "0". */
export function formatPp(pp: number): string {
  const r = round1(pp);
  if (r === 0) return "0";
  return r > 0 ? `+${trimNumber(r)}` : `−${trimNumber(Math.abs(r))}`;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local date, e.g. "Nov 4". */
export function formatDay(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function formatDayYear(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Inclusive label for a half-open local period [start, end). */
export function formatPeriod(start: number, end: number): string {
  const lastDay = addLocalDays(end, -1);
  return `${formatDay(start)} – ${formatDay(lastDay)}`;
}

/** UTC calendar day "YYYY-MM-DD" → "Nov 4". */
export function formatUtcDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  void y;
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDayYear(ts)} ${hh}:${mm}`;
}
