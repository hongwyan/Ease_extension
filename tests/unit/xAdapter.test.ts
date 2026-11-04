// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buttonAnchor,
  detectContext,
  extractPost,
  outerPermalink,
  parsePermalink,
  timelinePosts,
} from "../../src/content/xAdapter";
import { meetsVisibility } from "../../src/content/tracker";
import { articleHtml, timelinePage, type FixturePost } from "../fixtures/xTimeline";

function load(cfg: Parameters<typeof timelinePage>[0], path = "/home") {
  const html = timelinePage(cfg);
  // Strip the controller script; render the For you posts statically.
  const body = html.replace(/<script>[\s\S]*<\/script>/, "");
  document.open();
  document.write(body);
  document.close();
  document.getElementById("timeline")!.innerHTML = cfg.forYou
    .map((p) => `<div data-testid="cellInnerDiv">${articleHtml(p)}</div>`)
    .join("");
  window.history.replaceState({}, "", path);
}

const P: FixturePost = { id: "1854000000000000001", author: "alice", text: "ChatGPT wrote my essay" };

beforeEach(() => load({ forYou: [P] }));

describe("context detection", () => {
  it("identifies For you from the selected tab, not the URL", () => {
    expect(detectContext().context).toBe("for-you");
    document.getElementById("tab-foryou")!.setAttribute("aria-selected", "false");
    document.getElementById("tab-following")!.setAttribute("aria-selected", "true");
    expect(window.location.pathname).toBe("/home");
    expect(detectContext().context).toBe("following");
  });

  it("excludes other routes and non-English UI", () => {
    window.history.replaceState({}, "", "/search?q=chatgpt");
    expect(detectContext().context).toBe("other");
    window.history.replaceState({}, "", "/alice/status/1");
    expect(detectContext().context).toBe("other");
    window.history.replaceState({}, "", "/home");
    document.documentElement.setAttribute("lang", "ja");
    expect(detectContext().context).toBe("unknown");
  });

  it("is unknown when the tabs are missing", () => {
    document.querySelector('[role="tablist"]')!.remove();
    expect(detectContext().context).toBe("unknown");
  });
});

describe("post extraction", () => {
  it("only returns main-timeline posts (not the sidebar card)", () => {
    const posts = timelinePosts();
    expect(posts).toHaveLength(1);
    expect(extractPost(posts[0]!)).toMatchObject({ statusId: P.id, author: "alice", eligible: true, lang: "en" });
  });

  it("takes the outer ID/author from its own permalink, never the quoted post", () => {
    load({
      forYou: [{ ...P, text: "Look at this", quote: { id: "1111111111111111111", author: "quoted_bob", text: "Claude AI is great" } }],
    });
    const post = timelinePosts()[0]!;
    const info = extractPost(post);
    expect(info.statusId).toBe(P.id);
    expect(info.author).toBe("alice");
    expect(info.text).toBe("Look at this");
    expect(info.hasQuote).toBe(true);
    expect(outerPermalink(post)).toEqual({ author: "alice", statusId: P.id });
  });

  it("a quote-only outer post (no own text) is not eligible", () => {
    load({ forYou: [{ ...P, text: "", quote: { id: "2", author: "bob", text: "ChatGPT tips" } }] });
    expect(extractPost(timelinePosts()[0]!)).toMatchObject({ eligible: false, ineligibleReason: "media-only" });
  });

  it.each<[string, FixturePost, string]>([
    ["ads", { ...P, ad: true }, "ad"],
    ["media-only posts", { ...P, text: "", media: true }, "media-only"],
    ["non-English posts", { ...P, text: "ChatGPT は便利", lang: "ja" }, "not-english"],
    ["undetermined language", { ...P, text: "🔥🔥", lang: "qme" }, "not-english"],
  ])("excludes %s", (_n, post, reason) => {
    load({ forYou: [post] });
    expect(extractPost(timelinePosts()[0]!)).toMatchObject({ eligible: false, ineligibleReason: reason });
  });

  it("allows text posts with media attachments", () => {
    load({ forYou: [{ ...P, media: true }] });
    expect(extractPost(timelinePosts()[0]!).eligible).toBe(true);
  });

  it("places the button after the outer action bar", () => {
    const post = timelinePosts()[0]!;
    const a = buttonAnchor(post)!;
    expect(a.after?.getAttribute("role")).toBe("group");
  });

  it("parses permalinks", () => {
    expect(parsePermalink("/alice/status/123")).toEqual({ author: "alice", statusId: "123" });
    expect(parsePermalink("https://x.com/alice/status/123/photo/1")).toEqual({ author: "alice", statusId: "123" });
    expect(parsePermalink("/alice/status/123/analytics")).toEqual({ author: "alice", statusId: "123" });
    expect(parsePermalink("https://evil.com/alice/status/123")).toBeNull();
    expect(parsePermalink("/i/status/123")).toBeNull();
  });
});

describe("visibility rule", () => {
  it("needs half the card, capped at half the viewport for tall cards", () => {
    expect(meetsVisibility(100, 200, 800)).toBe(true);
    expect(meetsVisibility(99, 200, 800)).toBe(false);
    expect(meetsVisibility(400, 2000, 800)).toBe(true); // tall card: cap = 400
    expect(meetsVisibility(399, 2000, 800)).toBe(false);
  });
});
