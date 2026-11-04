/**
 * Realistic X Home timeline fixtures, shared by unit tests (jsdom) and
 * browser tests (served on https://x.com via Playwright request interception).
 * Markup mirrors the structure X ships: primaryColumn, role=tablist tabs,
 * "Timeline: Your Home Timeline", cellInnerDiv > article[data-testid=tweet],
 * User-Name with <a role="link"><time>, tweetText[lang], role=group actions,
 * quoted posts as div[role=link] cards. Fixture data never ships in dist/.
 */

export interface FixturePost {
  id: string;
  author: string;
  name?: string;
  text?: string;
  lang?: string;
  ad?: boolean;
  media?: boolean;
  quote?: { id: string; author: string; text: string };
  /** Cell height in px (default 260). */
  height?: number;
  /** "Show more" / social context line, e.g. "Alice reposted". */
  socialContext?: string;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function articleHtml(p: FixturePost): string {
  const name = p.name ?? p.author;
  const quote = p.quote
    ? `<div role="link" tabindex="0" class="quote">
         <div data-testid="User-Name"><span>${esc(p.quote.author)}</span><span>@${esc(p.quote.author)}</span>
           <a href="/${esc(p.quote.author)}/status/${p.quote.id}" role="link"><time datetime="2026-11-01T10:00:00.000Z">Nov 1</time></a></div>
         <div data-testid="tweetText" lang="en" dir="auto"><span>${esc(p.quote.text)}</span></div>
       </div>`
    : "";
  return `<article data-testid="tweet" role="article" tabindex="0" aria-labelledby="x" data-fixture-id="${p.id}">
      ${p.socialContext ? `<div data-testid="socialContext"><span>${esc(p.socialContext)}</span></div>` : ""}
      <div class="hdr">
        <div data-testid="User-Name">
          <a href="/${esc(p.author)}" role="link"><span>${esc(name)}</span></a>
          <a href="/${esc(p.author)}" role="link" tabindex="-1"><span>@${esc(p.author)}</span></a>
          <span>·</span>
          <a href="/${esc(p.author)}/status/${p.id}" dir="ltr" aria-label="2 hours ago" role="link"><time datetime="2026-11-04T08:00:00.000Z">2h</time></a>
        </div>
        ${p.ad ? `<div><span>Ad</span></div>` : ""}
        <button data-testid="caret" aria-label="More">⋯</button>
      </div>
      ${p.text !== undefined && p.text !== "" ? `<div data-testid="tweetText" lang="${p.lang ?? "en"}" dir="auto"><span>${esc(p.text)}</span></div>` : ""}
      ${p.media ? `<div data-testid="tweetPhoto"><div class="img" aria-label="Image"></div></div>` : ""}
      ${quote}
      <div role="group" aria-label="Replies, reposts, likes">
        <button data-testid="reply" aria-label="Reply">💬 3</button>
        <button data-testid="retweet" aria-label="Repost">🔁 5</button>
        <button data-testid="like" aria-label="Like">♡ 12</button>
        <a href="/${esc(p.author)}/status/${p.id}/analytics" aria-label="View post analytics">📊 1K</a>
        <button aria-label="Share post">⇪</button>
      </div>
    </article>`;
}

export function cellHtml(p: FixturePost): string {
  return `<div data-testid="cellInnerDiv" style="height:${p.height ?? 260}px">${articleHtml(p)}</div>`;
}

export interface TimelineConfig {
  forYou: FixturePost[];
  following?: FixturePost[];
  theme?: "light" | "dim" | "dark";
  /** Spacer above the first post, px. Default 0. */
  topSpacer?: number;
}

const BG = { light: "#ffffff", dim: "#15202b", dark: "#000000" };
const FG = { light: "#0f1419", dim: "#f7f9f9", dark: "#e7e9ea" };

/** Full https://x.com/home document. A tiny controller script plays X's role. */
export function timelinePage(cfg: TimelineConfig): string {
  const theme = cfg.theme ?? "light";
  const data = JSON.stringify({ forYou: cfg.forYou, following: cfg.following ?? [] }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<title>Home / X</title>
<style>
  html, body { margin: 0; background: ${BG[theme]}; color: ${FG[theme]}; font-family: system-ui, sans-serif; }
  main { display: flex; gap: 24px; justify-content: center; }
  [data-testid="primaryColumn"] { width: 600px; border-left: 1px solid #ccc; border-right: 1px solid #ccc; }
  [role="tablist"] { display: flex; position: sticky; top: 0; background: ${BG[theme]}; z-index: 5; height: 53px; }
  [role="tab"] { flex: 1; text-align: center; padding: 16px; color: inherit; text-decoration: none; }
  [role="tab"][aria-selected="true"] { font-weight: 700; border-bottom: 4px solid #1d9bf0; }
  [data-testid="cellInnerDiv"] { box-sizing: border-box; border-bottom: 1px solid #ccc; overflow: hidden; }
  article { padding: 12px 16px; cursor: pointer; }
  .hdr { display: flex; gap: 6px; align-items: center; }
  .hdr a { color: inherit; }
  .quote { border: 1px solid #ccc; border-radius: 12px; padding: 8px; margin-top: 8px; }
  [role="group"] { display: flex; justify-content: space-between; max-width: 425px; margin-top: 8px; }
  [role="group"] button, [role="group"] a { background: none; border: 0; color: inherit; font: inherit; }
  .img { width: 100%; height: 120px; background: #888; border-radius: 12px; }
  [data-testid="sidebarColumn"] { width: 350px; }
</style>
</head>
<body>
<div id="react-root"><main role="main">
  <div data-testid="primaryColumn">
    <div role="tablist">
      <a href="/home" role="tab" aria-selected="true" id="tab-foryou"><span>For you</span></a>
      <a href="/home" role="tab" aria-selected="false" id="tab-following"><span>Following</span></a>
    </div>
    <section role="region">
      <div aria-label="Timeline: Your Home Timeline">
        <div id="spacer" style="height:${cfg.topSpacer ?? 0}px"></div>
        <div id="timeline"></div>
        <div style="height:1200px"></div>
      </div>
    </section>
  </div>
  <div data-testid="sidebarColumn"><aside aria-label="Who to follow">
    ${articleHtml({ id: "999000000000000001", author: "sidebar_acct", text: "ChatGPT trending sidebar card" })}
  </aside></div>
</main></div>
<script>
(() => {
  const DATA = ${data};
  const esc = ${esc.toString()};
  const articleHtml = ${articleHtml.toString()};
  const cellHtml = ${cellHtml.toString()};
  const tl = document.getElementById("timeline");
  const fx = (window.__fx = { navigations: [], data: DATA, known: {} });
  [...DATA.forYou, ...DATA.following].forEach((p) => (fx.known[p.id] = p));
  fx.render = (posts) => { tl.innerHTML = posts.map(cellHtml).join(""); };
  fx.setTab = (which) => {
    document.getElementById("tab-foryou").setAttribute("aria-selected", String(which === "forYou"));
    document.getElementById("tab-following").setAttribute("aria-selected", String(which === "following"));
    fx.render(which === "forYou" ? DATA.forYou : DATA.following);
  };
  /** In-place DOM recycling: same cellInnerDiv/article element, new post content. */
  fx.recycle = (index, post) => {
    const art = tl.querySelectorAll('[data-testid="cellInnerDiv"] > article')[index];
    const tmp = document.createElement("div");
    tmp.innerHTML = articleHtml(post);
    const fresh = tmp.firstElementChild;
    art.replaceChildren(...fresh.childNodes);
    art.setAttribute("data-fixture-id", post.id);
    fx.known[post.id] = post;
  };
  /** X re-render: replaces the article element entirely (new node, same post). */
  fx.rerender = (index) => {
    const cell = tl.querySelectorAll('[data-testid="cellInnerDiv"]')[index];
    const id = cell.querySelector("article").getAttribute("data-fixture-id");
    cell.innerHTML = articleHtml(fx.known[id]);
  };
  fx.append = (post) => tl.insertAdjacentHTML("beforeend", cellHtml(post));
  fx.navigate = (path) => { history.pushState({}, "", path); };
  document.querySelectorAll('[role="tab"]').forEach((t) =>
    t.addEventListener("click", (e) => { e.preventDefault(); fx.setTab(t.id === "tab-foryou" ? "forYou" : "following"); }));
  // Like X: clicking anywhere on a post navigates to it (recorded instead of navigating).
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("article");
    if (a) fx.navigations.push(a.getAttribute("data-fixture-id"));
  });
  fx.setTab("forYou");
})();
</script>
</body>
</html>`;
}
