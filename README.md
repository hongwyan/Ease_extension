# X Feed Lens

A Chrome (Manifest V3) extension for English text posts on X. Under each supported post on your **For you** timeline it adds a small **Feed context** button. One click answers three questions without any prompt:

1. **How often has this topic appeared in my recommendations?** Feed share over the last 7 days.
2. **Has that changed?** Compared with the previous 7 days, in percentage points.
3. **Is there an independent public signal?** English Wikipedia article views for the same tool (optional).

Everything is computed locally. There is no backend, account, API key, paid service or model download.

## Install (unpacked)

Requirements: Node.js 20+ (tested with Node 24) and Chrome or Chromium 120+.

```bash
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`dist/`** folder. `manifest.json` sits at its root.
4. Pin **X Feed Lens** from the puzzle-piece menu so the toolbar button is visible.

After pulling changes, run `npm run build` again and click the reload icon on the extension card. Tabs already open on X need a reload to pick up the new content script.

## First use

1. Click the toolbar button. The popup explains what is measured. Click **Enable recording on X**.
2. Optional: tick **Look up English Wikipedia article views**. This is a separate opt-in.
3. Open `https://x.com/home`, select **For you**, and scroll as usual.
4. Click **Feed context** under any supported post. The panel opens next to the post and shows:
   - the recognized topic (with a chip to switch when a post matches two topics);
   - **Feed share**, **Change**, **Repeated sources**, and a one-sentence interpretation built from those numbers;
   - **English Wikipedia article views** (when enabled and a mapping exists);
   - **Why this result?**: matched terms, the inclusion rule, the recorded sample size and up to three contributing posts with X permalinks.
5. Press **Escape** (or ×) to close. Focus returns to the button. The button works with the keyboard (Tab, then Enter).

The popup also has **Pause/Resume recording** and **Delete all data**.

## What is counted (the denominator)

An **exposure** is one *eligible English text post* that you actually saw on the For you timeline:

- **Where:** desktop `https://x.com/home` with the **For you** tab selected. The tab is read from the page's tab state (`aria-selected`), because Following uses the same URL. Following, search, profiles, post detail pages, lists, sidebars, modals and anything unrecognized are excluded. In-page navigation and tab switches are handled without a reload.
- **What:** the outer post must have its own visible text and X must mark that text as English. Posts may have attachments. Media-only posts, ads ("Ad"/"Promoted" or promoted-tracking markup) and quoted cards do not count as independent exposures. The status ID and author come from the outer post's own timestamp permalink, never from quoted material.
- **When:** the browser tab is visible, and at least half of the card is on screen continuously for **one second**. For cards taller than the viewport, half the viewport height is enough. Timers are cancelled when visibility, the post in that DOM node, the route, the tab, eligibility, pause or delete changes. All conditions are checked again right before writing.
- **How often:** once per post per *session*. A session is the lifetime of one top-level tab document, including in-page route changes. Deduplication by (session, status ID) is enforced in IndexedDB, so backscrolling, recycled DOM nodes, duplicate cards, repeated messages, overlapping writes and service-worker restarts never double-count. The same post seen in a new tab or after a reload may count again.
- Posts that match **no topic still count** in the denominator.
- Visible exposure is a proxy for what appeared on your screen. It does not show that you read the post.

Clicking **Feed context** never records anything.

### Language detection

The extension relies on X's own language detection: X annotates every post's text element with a `lang` attribute. Only `lang="en"` (or `en-*`) is eligible. Values such as `und`, `qme` (emoji only), `qht` (hashtags only) and `zxx`, or a missing attribute, are excluded. The X interface itself must be in English (`<html lang="en…">`), because tab labels ("For you", "Following") are matched in English.

Limitations: X's detector misclassifies very short, mixed-language and slang-heavy posts, and those errors flow into the denominator. Only the visible text is analyzed, so text hidden behind "Show more" is not classified.

## Metrics

Periods are local calendar days. **Current** = the last 7 days including today, `[today−6 00:00, tomorrow 00:00)`. **Previous** = the 7 days immediately before, `[today−13 00:00, today−6 00:00)`. The intervals are half-open and never overlap. Dates appear in the panel.

| Metric | Definition |
| --- | --- |
| **Feed share** | matching eligible exposures ÷ all eligible exposures in the period. Shown as both counts and a percentage. |
| **Change** | current share − previous share, in **percentage points**. Shows the previous dates and counts. "No comparison yet" when either denominator is empty. When either period has fewer than **20** recorded exposures, no direction is stated ("Not assessed"), but raw counts stay visible. |
| **Repeated sources** | exposures from the two most frequent known authors ÷ all topic exposures in the current period, plus the number of distinct known authors. If any author handles are missing, the panel says how many are covered. |

Periods are marked **partial** when recording started after the period began (this includes all time before installation) or when recording was paused during it.

The panel never estimates X's ranking or amplification, anyone's income or wealth, anyone's chance of success, or your state of mind.

Example: with 12 of 80 recorded posts mentioning ChatGPT this week and 3 of 75 last week, the panel shows **15%**, previous **4%**, change **+11 pp**, and the sentence: "12 of 80 recorded posts (15%) in the last 7 days mentioned ChatGPT, up from 3 of 75 (4%) in the previous 7 days."

## Topics

The catalog is bundled and versioned in [`src/shared/catalog.ts`](src/shared/catalog.ts). It currently contains:

| Topic | Kind | Rule (summary) | Public series |
| --- | --- | --- | --- |
| ChatGPT | tool | Names ChatGPT ("ChatGPT", "Chat GPT", "#ChatGPT") | Wikipedia `ChatGPT` |
| Claude AI | tool | "Claude AI", "Claude Code", "claude.ai", Claude model names, or "Claude" plus an AI context word. People named Claude (Monet, Debussy, Van Damme…) are excluded. | Wikipedia `Claude_(AI)` |
| Earning money with AI | claim | Requires AI evidence **and** income evidence (an income word, or a money amount with a sale or payment word) | None. No exact article exists, and a generic AI article would measure a different topic. |

When a post matches several topics, the default is the topic with the lowest `priority` number. The others appear as chips. Matching is case-insensitive and whole-word, and it is deterministic.

## English Wikipedia article views (optional)

- **Provider:** [Wikimedia Analytics API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html), per-article pageviews endpoint:
  `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/{article}/daily/{start}/{end}`. Data is CC0. The extension sends an `Api-User-Agent` header, as the Wikimedia access policy asks of browser clients, and waits for each request to finish before sending the next.
- **Inputs:** only the catalog article title and a date range. No post text, authors, IDs or browsing history leave the device. Requests are cookieless and send no referrer. The extension's CSP allows network connections to `wikimedia.org` only.
- **Periods:** the latest two complete, adjacent 7-day periods in UTC, taken from the last 21 days requested. Every date is validated. Missing days, a zero baseline and delayed publication are reported in the panel. The panel shows totals, direction, the article link, the period and the last update time.
- **Failure handling:** timeouts (8 s), HTTP 429 (with back-off), 404/no data, invalid payloads and offline use each get a message, with the most recent cached series shown when one exists. Successful responses are cached by article and date range. Public lookups run separately, so a slow or failed lookup never delays the personal numbers.
- These figures measure readership of one article. They are not comparable to feed share.

## Data and retention

- Stored locally in IndexedDB, one row per exposure: session ID, status ID, author handle, timestamp, matched topic IDs, catalog version and a ≤140-character excerpt. Wikipedia responses are cached as well.
- **30 days** of history are kept. Older rows are deleted automatically.
- **Pause** takes effect immediately in tabs that are already open, including cancelling pending timers.
- **Delete all data** removes history, excerpts and caches. A data "epoch" checked inside the same IndexedDB transaction ensures that pending timers, in-flight writes and in-flight Wikimedia requests can never bring deleted records back.
- Permissions: `storage`, plus host access to `https://x.com/*` only. The extension never calls X's private APIs and never reads credentials.

## Development

| Command | Purpose |
| --- | --- |
| `npm ci` | Install exact dependency versions from `package-lock.json` |
| `npm run build` | Build the release into `dist/` (esbuild; manifest at the root) |
| `npm run typecheck` | TypeScript strict type check (`tsc --noEmit`) |
| `npm run test:unit` | Vitest unit tests: classifier and catalog examples, metrics, Wikimedia parsing, IndexedDB store (fake-indexeddb), message validation, X adapter (jsdom) |
| `npm run browsers` | One-time download of the Playwright Chromium build used by browser tests (stored under `node_modules`) |
| `npm run test:e2e` | Builds, then loads `dist/` into Chromium and runs the end-to-end suite |
| `npm test` | Typecheck + unit tests + browser tests |

The browser tests launch Chromium with the built `dist/` as an unpacked extension. They serve realistic timeline fixtures on `https://x.com/home` and mock Wikimedia responses on `https://wikimedia.org` through request interception, so the production manifest, content script and service worker run unmodified. Fixtures live in `tests/fixtures/` and are never bundled into `dist/` (a test checks this).

Playwright always reports pages as visible. To test hidden tabs, the suite switches `document.visibilityState` inside the content script's own isolated world over the DevTools protocol and dispatches a real `visibilitychange` event.

Layout:

```
src/content/xAdapter.ts   ← every X selector and extraction rule
src/content/tracker.ts    ← MutationObserver / IntersectionObserver / 1-second dwell
src/content/ui/           ← button + anchored panel (shadow DOM, light/dark)
src/background/           ← service worker: message validation, IndexedDB, Wikimedia provider
src/shared/               ← catalog, classifier, metrics, sentences, Wikimedia parsing
src/popup/ + static/      ← toolbar popup and manifest
tests/unit, tests/e2e, tests/fixtures
```

### Updating X selectors

X changes its markup often. All selectors are in `SELECTORS` at the top of [`src/content/xAdapter.ts`](src/content/xAdapter.ts), together with the functions that use them: `detectContext`, `timelinePosts`, `outerPermalink`, `isAd`, `extractPost` and `buttonAnchor`. After changing them:

1. Update `tests/fixtures/xTimeline.ts` so the fixture matches X's new markup.
2. Run `npm run test:unit` and `npm run test:e2e`.
3. Repeat the live smoke test below.

### Updating topics

Edit [`src/shared/catalog.ts`](src/shared/catalog.ts): aliases, context terms, exclusions, inclusion rules, Wikipedia mappings and examples all live there. Every `examples.match` / `examples.noMatch` sentence runs as a unit test. Bump `CATALOG_VERSION` when matching behaviour changes. Only map a Wikipedia article when it measures exactly the same topic, and use the article's canonical title, not a redirect, because redirect views are not counted.

## Known limitations

- Desktop `x.com` with an English interface only. No mobile site, `twitter.com` pages, or other languages.
- Language comes from X's `lang` attribute (see above).
- Topic matching uses rules, not a model. It can miss paraphrases and can misfire on ambiguous words, for example "Claude" next to "agent".
- Visible-on-screen is a proxy for exposure, not attention. Muted or blocked content that X never shows is, of course, never counted.
- Author handles come from the post permalink. A repost is attributed to the original author.
- X markup changes can silently break detection until the selectors are updated. The live smoke test below is the guard.
- Wikipedia pageviews arrive a day or more late and measure one article's readers, not interest across the web.

## Live smoke test (manual checklist)

Run this with a logged-in desktop X account, interface language English:

1. Load `dist/` unpacked, open the popup and enable recording.
2. Open `https://x.com/home` with **For you** selected. Check that **Feed context** appears once under each normal English text post, below the reply/repost/like row, without covering it. Check that it does not appear on ads, media-only posts or the right sidebar.
3. Scroll slowly for about a minute. The popup's recorded count should rise roughly with the posts you stopped on.
4. Click **Feed context** on a post that mentions ChatGPT. The page must not navigate or expand the thread. The topic should be ChatGPT, and the counts should match the popup. Open **Why this result?** and follow an evidence link: it opens the right post.
5. Press Escape: the panel closes and focus returns to the button. Repeat using only the keyboard.
6. Switch to **Following**: the buttons disappear and the popup count stops rising. Switch back to For you: the buttons return without a reload.
7. Open a post (detail page) and come back with the browser Back button. Buttons and counting resume.
8. Switch X to Dim / Lights out: the panel turns dark.
9. Quote posts: check that the evidence link points to the outer post, not the quoted one.
10. Pause in the popup while a post is on screen: the count must not rise. Resume, then **Delete all data**: the count returns to 0 and stays there until you scroll to new posts.
11. Enable public lookups and open the panel on a ChatGPT or Claude post: Wikipedia totals appear, or an explanatory message if offline.
