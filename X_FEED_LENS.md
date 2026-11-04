# X Feed Lens — implementation and acceptance spec

## Outcome

Ship a working Chrome desktop extension for English text posts on X. When a user sees a post about a tool or someone making money with it, one click on **Feed context** should answer three questions: How often has this topic appeared in my recommendations? Has that changed? Is there an independent public signal for the same topic? The user never types a prompt. Give them enough evidence to decide whether the apparent urgency deserves their attention.

The deliverable is an unpacked, locally installable Manifest V3 extension, with source, tests, and installation instructions. Use English for the interface. Start in the current repository, follow its instructions, preserve existing work, and choose the simplest compatible TypeScript build. A developer should be able to reproduce the build from the lockfile. The first release must work without a paid service, model download, API key, account with the developer, or backend.

## A complete first-use flow

1. The toolbar popup explains what the extension measures and lets the user enable local recording on X. Show recording status, pause/resume, and delete-data controls. Public lookups are an independent opt-in.
2. On the desktop Home timeline with **For you** selected, add a small, keyboard-accessible **Feed context** button to supported posts, including posts with no recognized topic. It must not navigate to the post, expand the thread, cover native actions, or duplicate itself after a rerender.
3. Clicking opens a panel anchored to that post. Immediately show the recognized topic, personal counts, comparison period, and a one-sentence interpretation generated from measured values. Where relevant, show a second topic as a selectable chip. The panel closes with Escape and restores focus. Support X light and dark themes.
4. Under **Why this result?**, show matched terms, inclusion rules, recorded sample size, and up to three contributing posts with working X permalinks. For an unknown topic, explain coverage. If no exposures have qualified yet, show an empty state. Clicking must never create a qualifying exposure by itself.

## Capture the right denominator

- Support desktop `https://x.com`, English UI and English post text. Analyze visible text only. A post may have an attachment, but a media-only post is ineligible. Exclude identifiable ads, cards outside the main timeline, and nested quoted cards as independent exposures. Label the denominator in the UI as eligible English text posts. Document the language detection method and limitations.
- Identify the active **For you** tab from page state. The Home URL alone also matches Following. Exclude Following, search, profiles, post details, and unknown contexts. Handle in-page navigation and tab changes without requiring a reload. Keep X-specific selectors and extraction in one adapter. Obtain the outer post's stable status ID and author from its own permalink, independently of links in quoted material.
- Observe dynamic cards with MutationObserver and exposure with IntersectionObserver. Count an exposure when the tab is visible and at least half of the card, capped at half of the viewport height for tall cards, has remained visible continuously for one second. Cancel pending timers when visibility, post identity, route, or eligibility changes. Recheck all conditions before writing. Treat visible exposure as a proxy for what appeared on screen.
- A session is one top-level tab document lifetime, including its in-page route changes. Deduplicate by session and status ID in persistent storage. Backscrolling, DOM recycling, repeated messages, and overlapping writes must not double-count. Seeing the same post in a new session may count again. Every eligible exposure contributes to the denominator, even if classification returns no topic.

## Storage and topic matching

Use a content script for the adapter and UI, and an extension service worker for validated messages, IndexedDB transactions, and optional public requests. Persist data when an exposure qualifies. Service-worker suspension must preserve history and deduplication. Store only the data needed for the metrics and evidence links. A short excerpt is sufficient. Keep 30 days of local history. Pausing stops collection in already-open tabs. Clearing data removes history, excerpts, and caches; pending writes or requests must not resurrect deleted records.

Bundle a small, versioned English topic catalog. At minimum support **ChatGPT**, **Claude AI**, and **earning money with AI**. The first two represent concrete tools; the third represents a claim. A post can match both. For earnings, require AI and income-related evidence together. “I used AI to organize my notes” should not match earnings; “I sold an AI-generated logo to a client for $80” should. “Claude Monet” should not match Claude AI. Keep aliases, exclusions, and examples editable in one place. Choose a deterministic default when multiple topics match. Numeric results must be computed in code. Local rules and sentence templates are sufficient for release.

## Metrics and interpretation

Use the last seven days and the immediately preceding seven days, with explicit, nonoverlapping boundaries. For each selected topic display:

- **Feed share** = matching eligible exposures / all eligible exposures. Show both counts and the percentage.
- **Change** = current share minus previous share, in percentage points. Show dates and prior counts. Mark partial observation periods, including time before installation. Show “No comparison yet” for an empty denominator. Suppress directional wording when either period has fewer than 20 recorded exposures; raw counts stay visible.
- **Repeated sources** = topic exposures from the two most frequent known authors / all topic exposures. Show the count of distinct known authors. If any authors are missing, disclose coverage or suppress this metric.

The feed share is the user-facing concentration indicator. A result such as “12 of 80 recorded posts mentioned ChatGPT, up from 3 of 75” is meaningful by itself. Do not estimate the platform's causal amplification, anyone's wealth percentile, an individual's success probability, or the user's mental state from these observations.

## Independent public trend

Implement one real, keyless provider for the English Wikipedia article pageviews of supported tool topics, using the [Wikimedia Analytics API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html). Keep exact article mappings in the catalog and verify the provider's current endpoint and usage requirements. For “earning money with AI,” show “No comparable public series” unless there is an explicitly justified exact mapping. A generic AI article would measure a different topic.

When enabled, fetch the latest two complete seven-day periods available, validate all dates, and display totals, direction, article link, period, and last update under **English Wikipedia article views**. These measure readership of a particular article. Keep this series separate from feed share. Handle a zero baseline, missing days, delayed data, timeout, rate limiting, and offline use. Cache successful responses by article and date range. A failed or slow lookup must never delay the personal panel. The provider may receive only a catalog article identifier and date range as query inputs. No post content, author IDs, or browsing history leave the device. Keep permissions scoped to X and the optional provider. Do not call private X APIs or obtain credentials.

## Verification and delivery

1. Provide reproducible build, typecheck, unit-test, and browser-test commands. Build a release directory with its manifest at the root. Load the built extension in Chromium for an end-to-end test. Serve realistic test timelines through browser request interception on the supported origin so the production manifest and content script actually run. Keep fixture data out of the release.
2. Test the full path from scrolling to persisted history to clicking a post and rendering its numbers. Cover recycled cards, duplicate delivery, background-tab cancellation, For you → Following on the same URL, quote/outer ID confusion, unknown topics in the denominator, and pause/delete while a timer is pending. Cover cold start, missing public data, cached/offline results, and public lookups disabled. For a seeded history of 12/80 versus 3/75, assert 15%, 4%, and +11 percentage points.
3. If an authorized logged-in X desktop session is available, smoke-test the release on the actual For you feed. Check button placement, topic extraction, counting, and route changes. If live verification requires a login or the network is unavailable, complete every local check, report exactly what remains unverified, and provide a short manual smoke-test checklist. Never report fixture runs as live-site verification.
4. Deliver the source, lockfile, built extension, and a concise README covering exact install steps, first use, data retention, metric definitions, provider attribution, known limitations, and how to update selectors or topics. Run the checks, fix failures, and report the build folder, commands and results, and live verification status. A design document, a standalone demo page, or a screenshot alone does not satisfy this goal.
