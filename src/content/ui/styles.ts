/** Styles live inside shadow roots so X's CSS and ours never collide. */

const TOKENS = `
:host { all: initial; }
:host([data-theme="light"]) {
  --fl-bg: #ffffff; --fl-fg: #0f1419; --fl-muted: #536471; --fl-border: #cfd9de;
  --fl-soft: #f7f9f9; --fl-accent: #1d9bf0; --fl-accent-fg: #ffffff; --fl-chip: #eff3f4;
  --fl-warn: #8a5a00; --fl-shadow: 0 8px 28px rgba(15,20,25,.18);
}
:host([data-theme="dark"]) {
  --fl-bg: #16181c; --fl-fg: #e7e9ea; --fl-muted: #8b98a5; --fl-border: #38444d;
  --fl-soft: #202327; --fl-accent: #1d9bf0; --fl-accent-fg: #ffffff; --fl-chip: #2f3336;
  --fl-warn: #f5c451; --fl-shadow: 0 8px 28px rgba(0,0,0,.6);
}
* { box-sizing: border-box; }
`;

export const BUTTON_CSS = `${TOKENS}
:host { display: inline-flex; vertical-align: middle; }
button {
  font: 500 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--fl-muted); background: transparent; border: 1px solid var(--fl-border);
  border-radius: 999px; padding: 3px 10px; margin: 4px 0 2px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
}
button:hover { color: var(--fl-accent); border-color: var(--fl-accent); }
button:focus-visible { outline: 2px solid var(--fl-accent); outline-offset: 2px; }
button[aria-expanded="true"] { color: var(--fl-accent); border-color: var(--fl-accent); }
svg { width: 13px; height: 13px; }
`;

export const PANEL_CSS = `${TOKENS}
:host { position: absolute; z-index: 2147483000; }
.panel {
  width: min(380px, calc(100vw - 16px)); max-height: min(560px, calc(100vh - 24px)); overflow: auto;
  background: var(--fl-bg); color: var(--fl-fg); border: 1px solid var(--fl-border);
  border-radius: 14px; box-shadow: var(--fl-shadow); padding: 14px 16px 12px;
  font: 400 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.panel:focus { outline: none; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
h2 { font-size: 15px; line-height: 20px; margin: 0; font-weight: 700; }
h3 { font-size: 12px; line-height: 16px; margin: 0 0 4px; font-weight: 700; color: var(--fl-muted);
  text-transform: uppercase; letter-spacing: .04em; }
.close { background: transparent; border: 0; color: var(--fl-muted); font-size: 18px; line-height: 1;
  width: 28px; height: 28px; border-radius: 50%; cursor: pointer; }
.close:hover { background: var(--fl-soft); color: var(--fl-fg); }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--fl-accent); outline-offset: 2px; }
.topicrow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; }
.topic { font-weight: 700; font-size: 14px; }
.chip { border: 1px solid var(--fl-border); background: var(--fl-chip); color: var(--fl-fg); border-radius: 999px;
  padding: 2px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--fl-accent); border-color: var(--fl-accent); color: var(--fl-accent-fg); }
section { border-top: 1px solid var(--fl-border); padding: 10px 0; }
.body > section:first-child { border-top: 0; padding-top: 0; }
.body > .empty, .body > .note { margin: 0 0 10px; }
.metric { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; margin: 6px 0; }
.metric .name { font-weight: 600; }
.metric .value { font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
.metric .detail { grid-column: 1 / -1; color: var(--fl-muted); font-size: 12px; }
.note { color: var(--fl-warn); font-size: 12px; }
.muted { color: var(--fl-muted); font-size: 12px; }
table.scopes { width: 100%; border-collapse: collapse; margin: 4px 0 6px; font-variant-numeric: tabular-nums; }
table.scopes th, table.scopes td { padding: 5px 4px; vertical-align: top; text-align: right; border-top: 1px solid var(--fl-border); }
table.scopes thead th { border-top: 0; font-size: 12px; color: var(--fl-muted); font-weight: 700; }
table.scopes tbody th { text-align: left; font-weight: 600; width: 34%; }
table.scopes .value { display: block; font-weight: 700; font-size: 14px; }
table.scopes .value.word { font-size: 12px; line-height: 16px; }
table.scopes .sub { display: block; color: var(--fl-muted); font-size: 11px; font-weight: 400; line-height: 14px; }
.small { font-size: 12px; margin: 4px 0; }
.sentence + .sentence { margin-top: 6px; }
.sentence { margin: 8px 0 0; padding: 8px 10px; background: var(--fl-soft); border-radius: 10px; }
details summary { cursor: pointer; font-weight: 600; }
ul { margin: 6px 0; padding-left: 18px; }
li { margin: 3px 0; }
a { color: var(--fl-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.evidence li { list-style: none; margin-left: -18px; padding: 6px 8px; background: var(--fl-soft); border-radius: 8px; margin-bottom: 6px; }
.evidence .meta { font-size: 12px; color: var(--fl-muted); }
.empty { padding: 8px 10px; background: var(--fl-soft); border-radius: 10px; }
footer { color: var(--fl-muted); font-size: 11px; border-top: 1px solid var(--fl-border); padding-top: 8px; }
`;
