type Child = Node | string | null | undefined | false;

/** Tiny DOM builder. Text is always set via text nodes, never innerHTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Stops events from reaching X's handlers (post navigation, thread expansion, shortcuts). */
export function isolateEvents(el: EventTarget, types: string[]): void {
  for (const t of types) el.addEventListener(t, (e) => e.stopPropagation());
}

export const ISOLATED_EVENTS = [
  "click",
  "auxclick",
  "dblclick",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchstart",
  "touchend",
  "keydown",
  "keyup",
  "keypress",
];
