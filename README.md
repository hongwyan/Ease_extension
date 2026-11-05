# X Feed Lens

A Chrome (Manifest V3) extension for text posts on X, in any language. Under each supported post on your **For you** timeline it adds a small **Feed context** button. One click, with no prompt to type and no API key, answers:

1. **How many of the other posts I actually saw are about the same subject as this one?** Measured among posts in **the post's own language** and among posts in **all languages**, over the last 7 days.
2. **Has that changed?** Compared with the previous 7 days, in percentage points.
3. **Which posts were they?** Up to three of the most similar recorded posts, with links.

Relatedness is judged by a **multilingual language model that ships inside the extension and runs on your device** ([`gte-multilingual-base`](https://huggingface.co/Alibaba-NLP/gte-multilingual-base), Apache-2.0). Post text never leaves the device. There is no backend, account, API key or paid service. A small bundled catalog of named topics (ChatGPT, Claude AI, earning money with AI) remains available as secondary chips, with an optional English Wikipedia comparison.

## Install (unpacked)

Requirements: Node.js 22+ (tested with Node 24), Chrome or Chromium 120+, about 1 GB of free disk space.

```bash
npm ci
npm run model:fetch
npm run build
```

`npm run model:fetch` downloads the pinned model files (≈ 357 MB) from Hugging Face into `.cache/models/`, outside `dist/`, and verifies the size and SHA-256 of every file against [`scripts/models.lock.json`](scripts/models.lock.json). It honours `HTTPS_PROXY`. The build copies them into `dist/` and **fails if any file is missing or altered**.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`dist/`** folder (`manifest.json` sits at its root).
4. Pin **X Feed Lens** from the puzzle-piece menu.

### Updating an installed copy

After `npm run build`, click the **Reload** (circular arrow) button on the X Feed Lens card in `chrome://extensions`, then reload any open X tabs. Use the Reload button rather than only restarting Chrome: it re-registers the extension's service worker, so the new version (and its database upgrade) actually runs. Your recorded history is kept (see [Upgrading from 0.1/0.2](#upgrading-from-0102)).

## Using it

1. Click the toolbar button and **Enable recording on X**. Optionally enable the English Wikipedia lookup (separate opt-in, catalog topics only).
2. Open `https://x.com/home`, select **For you**, and scroll as usual. Posts you actually see are recorded locally.
3. Click **Feed context** under any text post. The panel opens immediately next to the post with:
   - an excerpt of the clicked post, so the analysis target is clear;
   - the view selector: **Similar to this post** (selected automatically), followed by any matching catalog topics;
   - while the local model works: a progress bar with **Stop**. You can keep scrolling. The first analysis after installing or after a lot of browsing takes longest (see [Performance](#performance));
   - the result table, with one column for the post's language and one for **All languages**:
     | Row | Meaning |
     | --- | --- |
     | **Related recorded posts** | related ÷ analyzed other posts, last 7 days (for example "15%, 12 of 80") |
     | **Previous 7 days** | the same for the 7 days before |
     | **Change** | difference in percentage points, or why no direction is stated |
     | **Repeated authors** | share of related posts from the two most frequent authors |
     | **Other recorded posts** | how many other posts were recorded, how many were analyzed, pending, or had no usable text |
   - a one-sentence reading of each column, a note that relatedness is an estimate (opposing opinions about the same subject both count), and **Most similar recorded posts** with "Open on X" links;
   - **Why this result?**: current-post exclusion, older records analyzed from excerpts, coverage, frequent authors, sample sizes, how relatedness is decided, and catalog coverage as a diagnostic.
4. Escape (or ×) closes the panel and returns focus to the button. Everything works with the keyboard.

Distinct states are never merged: **No other recorded posts yet**, **No related posts found** (among N analyzed), **Too little text to compare** (emoji, links only, one word), **Partial result** (after Stop, with *Finish analysis*), and **analysis failed** (model missing, broken runtime, timeout), which offers **Try again**. A failure is never shown as "0 related". Opening the panel, retrying or stopping never records an exposure.

## How relatedness works

- **Query-relative and automatic.** The clicked post is the query. Its visible text and every other recorded post in the two comparison periods are turned into meaning vectors by the bundled encoder. Every assessable post is compared with the query; nothing is limited to the top-K matches. Top matches are only used to choose the evidence shown.
- **Decision.** A post counts as related when the cosine similarity reaches **0.67** for posts with the same X language tag, or **0.60** across languages. Same-subject posts in different languages score systematically lower. These cutoffs were chosen on the calibration half of a labeled fixture with the packaged runtime (see [Semantic quality](#semantic-quality)). A similarity is not a probability, and relatedness does not mean agreement.
- **Model.** `onnx-community/gte-multilingual-base` at revision `2edbf5e6`, an ONNX export of `Alibaba-NLP/gte-multilingual-base` (Apache-2.0), int8-quantized, `[CLS]` pooling, L2-normalized, 768 dimensions. It runs with [Transformers.js](https://github.com/huggingface/transformers.js) 4.3.2 and ONNX Runtime Web (CPU/WASM SIMD, up to 4 threads) in a dedicated worker inside an extension **offscreen document**. Remote model loading, the browser model cache and CDN WASM defaults are switched off. Model files, tokenizer and runtime load only from the extension package.
- **Preprocessing** (versioned): Unicode NFKC, links removed, whitespace collapsed. Posts with fewer than 2 content units (words, or CJK characters) are *unassessable*, not unrelated.
- **Long posts.** Text is split at sentence boundaries into chunks of at most **96 tokens**, counted with the model's own tokenizer, up to **8 chunks** (768 tokens). The chunk vectors are averaged. Text beyond that is not analyzed, and the panel says so. This policy was compared with single-pass 512-token encoding on the fixture's long posts (14/16 vs 12/16 long-post pairs correct).
- **Cache.** Vectors are stored in IndexedDB, keyed by `hash(model + revision + quantization + pooling + preprocessing version + chunking policy) : SHA-256(analysis text)`. Identical text is encoded once, but each exposure still counts. Changing the model or the policy changes every key, so incompatible vectors are never mixed. Vectors of a clicked post that is not itself recorded are kept in memory only.
- **Indexing.** It happens only when you open the panel, never on the exposure-recording path. Missing vectors are encoded in batches of 16. Progress is reported, and **Stop** keeps a partial result whose unanalyzed rows stay *pending*. Two X tabs share one model instance and one in-flight encode per text. If Chrome suspends the service worker, the next poll rebuilds the job from the durable cache.

## Statistics

Periods are local calendar days. **Current** = the last 7 days including today, `[today−6 00:00, tomorrow 00:00)`. **Previous** = `[today−13 00:00, today−6 00:00)`. The intervals are half-open. The language column only counts posts X tagged with the clicked post's language; the All languages column counts every eligible post.

For each period and column, the panel computes these counts over **other** recorded posts:

- **eligible**: every exposure in the period except **all exposures of the clicked status ID**, which are removed from numerator and denominator in both periods. Other repeated exposures count once per session, as before.
- **assessed** = related + unrelated; **unassessable** (no usable text); **pending** (not encoded yet).
- **Share** = related ÷ assessed, labelled "of analyzed other posts". **Coverage** = assessed ÷ eligible.
- **Change** = current share − previous share, in percentage points. A direction is stated only when **both periods have ≥ 20 assessed posts and every eligible post in both periods was assessed** (nothing pending or unassessable). Otherwise the panel says "No comparison yet" or "Not stated" and gives the reason, and the counts stay visible.
- **Repeated authors**: exposures from the two most frequent known authors ÷ related exposures in the current period.

Example: 12 of 80 analyzed other posts related this week and 3 of 75 last week gives **15%**, **4%**, **+11 pp**, "up" (unit-tested). Periods are marked partial when recording started late or was paused.

The catalog chips keep their original definitions: catalog matches ÷ **all** recorded posts, including the clicked one. Wikipedia lookups are tied to exact catalog mappings only; an arbitrary post never triggers a public lookup. "No catalog topic" is no longer shown as a result. It appears only as a coverage diagnostic under **Why this result?**.

## Semantic quality

The labeled fixture [`tests/semantic/fixture.ts`](tests/semantic/fixture.ts) is human-reviewable: 163 Chinese and English posts in 14 topic families. Ten are outside the catalog (housing, exams, careers, fitness, travel, relationships, software, investing, food, pets); the other four cover ambiguous names (Python, Apple, Amazon, Java) and different uses of ChatGPT and Claude. It has **1,246 labeled pairs**: translations, same-subject paraphrases in and across languages, and hard negatives (shared words, ambiguous names, the same tool used differently, negation, satire, short and long posts), plus balanced en–en / zh–zh / en–zh cross-family negatives. Ten adjacent-subject pairs are recorded as **ambiguous** and excluded. Families were split into **calibration** and **held-out** halves before tuning; every translation and paraphrase stays in its family's half.

Release gate (`npm run eval:semantic`), on the **packaged extension's own runtime**. The full report, including every misclassified pair, is in [`tests/semantic/REPORT.md`](tests/semantic/REPORT.md).

| Held-out (determinate pairs) | Precision | Recall |
| --- | --- | --- |
| All (91 TP, 2 FP, 28 FN, 522 TN) | **97.8%** | **76.5%** |
| English–English | 92.9% | 54.2% |
| Chinese–Chinese | 100% | 72.7% |
| English–Chinese | 98.4% | 84.9% |

Targets: precision ≥ 90%, recall ≥ 75%. The gate passes, but recall clears the target only narrowly, and **English–English recall is weak**: casual English paraphrases that share few words are often missed. This is a regression gate on a small fixture, not a claim of general accuracy.

**Model selection.** The plan's starting candidate, `paraphrase-multilingual-MiniLM-L12-v2`, failed the gate (held-out about 86% precision / 62–71% recall). Five other pinned local encoders were benchmarked with the same harness (`npm run eval:candidates`): multilingual-e5-small (failed, clusters by language), granite-embedding-97m-multilingual-r2 (failed on recall), snowflake-arctic-embed-m-v2.0 (failed), paraphrase-multilingual-mpnet-base-v2, and gte-multilingual-base. On the packaged runtime only gte passed (mpnet: 90.8% / 74.8%). Language-aware cutoffs replaced a single cutoff because cross-language pairs score systematically lower. Corpus- or query-centered scores were rejected: centering on your own history would understate exactly the subjects that dominate it.

## Performance

Measured with `npm run bench` on an Intel i5-12600KF (16 threads), 32 GB RAM, Windows 11, headless Chromium, 1,000 unique recorded posts. Details are in [`tests/semantic/PERF.md`](tests/semantic/PERF.md).

| Measure | Result | Target |
| --- | --- | --- |
| Panel shell (click → painted) | median 15 ms, max ≈ 72 ms | < 200 ms |
| Warm analysis (history already analyzed) | median ≈ 840 ms, max ≈ 910 ms | < 2 s |
| Cold analysis: model load (≈ 1.4 s) + encode 1,001 texts | ≈ 63–66 s, about 15–16 posts/s, with progress and Stop | — |
| Memory, all Chromium processes | +≈ 1.1 GB while the model is loaded; back to near baseline after 90 s idle | — |
| Package size | ≈ 373 MB (model 357 MB, ONNX Runtime 14 MB, code 1.4 MB) | — |

Cold time scales with the number of recorded posts not analyzed yet. Later clicks only encode new posts. Slower machines will be proportionally slower. The worker uses up to 4 threads, because extension pages are cross-origin isolated through the manifest's COOP/COEP keys.

## Data, privacy and deletion

- **Stored locally in IndexedDB**, per exposure: session ID, status ID, author handle, timestamp, X's language tag, matched catalog topics, catalog version, a ≤140-character display excerpt, and (new in 0.3) the post's **visible outer-post text, up to 4,000 characters**, used for analysis. Also stored: meaning vectors derived from that text, and cached Wikipedia responses. Quoted posts and text hidden behind "Show more" are not captured.
- **30 days** of history are kept. Vectors that no retained post references any more (aged out, deleted, or made by an older model) are swept after analyses.
- **Delete all data** removes history, stored text, excerpts, vectors, running and queued analyses, results shown in open panels (they are recomputed) and cached public data. It also releases the model's memory. A data epoch checked inside the same IndexedDB transaction stops in-flight writes, including vectors computed mid-deletion, from bringing anything back. The bundled model files are part of the extension, contain none of your data, and stay installed.
- **Network:** with public lookups off (the default), the extension makes no external requests at all. A browser test proves this for the service worker, the offscreen document, the inference worker and ONNX Runtime's thread workers, using DevTools network logs, Chromium's NetLog and a recording proxy, with positive controls. The CSP limits connections to the extension itself and `wikimedia.org`, which is used only for the opt-in lookup of a catalog article title.
- **Permissions:** `storage`, `offscreen` (to host the inference worker), and host access to `https://x.com/*` only. CSP: `script-src 'self' 'wasm-unsafe-eval'` (local WebAssembly only). The extension never calls X's private APIs and never reads credentials.

## Upgrading from 0.1/0.2

The IndexedDB schema migrates incrementally from version 1 to 2 by adding the vector store. Existing rows are left exactly as they were, and historical catalog assignments are never rewritten. This is browser-tested with a real 0.2.0 build and the same profile.

**Limitations of older history:**

- Posts recorded before 0.3 have **no stored text**. They are analyzed from their **140-character excerpt**, flagged "older record, excerpt only" in the evidence, and counted under **Why this result? → Older records analyzed from excerpts**. Relatedness for long posts is therefore judged on their beginning only. Posts are never re-fetched from X.
- Rows without a language tag (0.1) count as English, as before.
- Rows whose excerpt has no usable text are *unassessable*. They are not counted as unrelated, and while any exist in a period, no direction is stated.
- All of this ages out with the 30-day retention.

## Catalog topics (secondary view)

The bundled, versioned catalog in [`src/shared/catalog.ts`](src/shared/catalog.ts) still recognizes **ChatGPT**, **Claude AI** and **Earning money with AI** by explicit, multilingual rules (unchanged from 0.2). When a post matches, its topics appear as chips after **Similar to this post**. Selecting one shows the catalog view: feed share among all recorded posts, change, repeated sources and, for tool topics, the optional **English Wikipedia article views** (Wikimedia Analytics API, CC0; only the article title and a date range are sent).

## What is counted (exposures)

An **exposure** is one eligible text post (any language) that you actually saw on the For you timeline. That means desktop `https://x.com/home` with **For you** selected (read from `aria-selected`), the outer post's own visible text, and at least half of the card (or half the viewport for tall cards) on screen for one continuous second in a visible tab. Ads, media-only posts and quoted cards are excluded. Each post counts once per tab session, deduplicated in IndexedDB. Language comes from X's `lang` attribute, normalized to its primary subtag. The X interface itself must be in English, because the tab labels are matched in English.

## Development

| Command | Purpose |
| --- | --- |
| `npm ci` | Install exact dependency versions |
| `npm run model:fetch` | Download and verify the pinned release model into `.cache/models` |
| `npm run build` | Build `dist/` (fails if model or runtime assets are missing or altered) |
| `npm run typecheck` | TypeScript strict type check |
| `npm run test:unit` | Vitest: catalog, metrics, semantic statistics, chunking, migration (real v1 schema), coordinator (deterministic encoder double), messages, X adapter |
| `npm run eval:semantic` | Release quality gate: real inference in the packaged extension; writes `tests/semantic/REPORT.md` |
| `npm run eval:candidates` | Model-selection comparison in Node (downloads every candidate in the lock) |
| `npm run browsers` | One-time download of the Playwright Chromium build |
| `npm run test:e2e` | Build, then browser tests on the unpacked release (real inference) |
| `npm run bench` | 1,000-post performance benchmark; writes `tests/semantic/PERF.md` |
| `npm test` | Typecheck + unit tests + semantic gate + all browser tests |

Browser tests load `dist/` into Chromium and serve timeline fixtures on `https://x.com/home` through request interception, so the production manifest, service worker, offscreen document, worker and model run unmodified. Beyond the original suite, they cover Chinese paraphrases outside the catalog, cross-language matches, unrelated posts, unrecorded clicked posts, rapid clicks on different posts, Stop/partial results, closing and route changes, deletion during analysis, service-worker restart, two tabs, missing model weights, a broken WASM runtime, the 0.2 → 0.3 upgrade and network privacy. Failure cases use modified copies of the release folder. Fixtures and evaluation data never enter `dist/`, and a test checks this. Model binaries are checked by SHA-256 against the lock, not scanned as text.

Layout:

```
src/content/        ← X adapter, exposure tracker, button + panel (shadow DOM)
src/background/     ← service worker: validation, IndexedDB (db.ts), semantic coordinator, offscreen client, Wikimedia
src/offscreen/      ← offscreen document hosting the inference worker
src/semantic/       ← encoder (Transformers.js), worker, preprocessing/chunking, model identity + cutoffs
src/shared/         ← catalog, classifier, metrics, semantic statistics, sentences, messages
scripts/            ← build, model fetch + lock, evaluation runner
tests/unit, tests/e2e, tests/semantic (fixture, gate, reports), tests/bench
```

To change the model: add it to `scripts/models.lock.json` with pinned revision and hashes, add a candidate in `tests/semantic/candidates.ts`, compare with `npm run eval:candidates`, then switch `release` in the lock and `RELEASE_ENCODER` in `src/semantic/model.ts`, run `npm run eval:semantic`, and copy the cutoffs the calibration rule selects into `RELATED_THRESHOLDS` (the gate fails until they match).

## Known limitations

- **Relatedness is an estimate.** It misses some casual paraphrases, especially English–English (held-out recall about 54%). It can over-match posts that share a concept but not the subject: for example "the noodle shop raised prices again" scores as related to "Shanghai rent went up again". Cutoffs were calibrated on Chinese and English; other languages use the same cutoffs without dedicated evaluation.
- The first analysis on a large unanalyzed history takes about a minute per 1,000 posts on a fast desktop (longer on laptops), and loading the model uses about 1 GB of memory until it is released after 90 seconds idle.
- The extension is large (≈ 373 MB) because the model ships with it.
- Desktop `x.com` with an English interface only. Visible-on-screen is a proxy for exposure, not attention.
- X markup changes can break detection until the selectors in [`src/content/xAdapter.ts`](src/content/xAdapter.ts) are updated.
- Wikipedia pageviews are English Wikipedia only, arrive with a delay, and measure one article's readers.

## Live smoke test (manual checklist)

Run this with a logged-in desktop X account, interface language English, after reloading the extension:

1. Open the popup: it shows recording state and the number of recorded posts (plus "analyzed texts cached" once you have used the panel).
2. On `https://x.com/home` (For you), check that **Feed context** appears once under each normal text post, not on ads, media-only posts or the sidebar.
3. Click it on any post. The panel opens instantly with the post's excerpt and **Similar to this post** selected, and the page does not navigate. The first time, a progress bar appears; let it finish (or Stop, then *Finish analysis*).
4. Check that the related count looks plausible, then open two or three evidence links: they should be posts about the same subject. Try a Chinese or other non-English post: the first column is named after its language.
5. Click Feed context on a different post right away: the panel shows the new post's excerpt and, once done, its own results.
6. Open **Why this result?**: older records are reported as analyzed from excerpts if you used 0.1/0.2, and the clicked post is excluded.
7. On a ChatGPT/Claude post, select the catalog chip: the catalog counts and (if enabled) Wikipedia views appear.
8. Escape closes the panel and returns focus. Following tab, post detail pages, Dim / Lights out and Pause behave as before.
9. **Delete all data** while a panel is open: the panel recomputes and shows no history. The popup shows 0 posts and no cached texts.
