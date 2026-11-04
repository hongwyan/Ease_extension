import { addDays } from "../../src/shared/wiki";

/** Builds a Wikimedia per-article daily response; return null from `views` to omit a day. */
export function wikiItems(article: string, from: string, to: string, views: (day: string, i: number) => number | null) {
  const items = [];
  let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1), i++) {
    const v = views(d, i);
    if (v === null) continue;
    items.push({
      project: "en.wikipedia",
      article,
      granularity: "daily",
      timestamp: `${d.replaceAll("-", "")}00`,
      access: "all-access",
      agent: "user",
      views: v,
    });
  }
  return { items };
}
