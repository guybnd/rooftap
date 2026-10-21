import { priceTextToCents, type SourceDeal } from "@homeup/core";
import type { ShopperSource } from "./types";

// Community deals from OzBargain's public front-page RSS feed
// (https://www.ozbargain.com.au/wiki/rss_feeds). Australia only. The feed is
// fetched once and filtered locally by the want's words, so a lookup costs
// OzBargain one request however many wants ask.

const FEED = "https://www.ozbargain.com.au/deals/feed";
const CACHE_MS = 30 * 60 * 1000;
let cache: { at: number; items: SourceDeal[] } | null = null;

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

function tag(item: string, name: string): string | null {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : null;
}

export function parseOzBargainFeed(xml: string): SourceDeal[] {
  const deals: SourceDeal[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = tag(m[1], "title");
    const url = tag(m[1], "link");
    if (!title || !url?.startsWith("https://")) continue;
    const price = title.match(/\$\s?[\d,]+(?:\.\d{2})?/);
    const pubDate = tag(m[1], "pubDate");
    deals.push({
      title,
      url,
      price_cents: price ? priceTextToCents(price[0]) : null,
      currency: price ? "AUD" : null,
      posted_at: pubDate ? new Date(pubDate).toISOString() : null,
    });
  }
  return deals;
}

/** Every word of the query (3+ letters or any number) appears in the title. */
export function dealMatches(title: string, query: string): boolean {
  const hay = title.toLowerCase();
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /\d/.test(w));
  return words.length > 0 && words.every((w) => hay.includes(w));
}

export const ozbargain: ShopperSource = {
  manifest: {
    id: "ozbargain",
    name: "OzBargain",
    regions: ["AU"],
    capabilities: ["deals"],
    kind: "feed",
    env: [],
    attribution: "Deals from OzBargain",
    homepage: "https://www.ozbargain.com.au",
    ratePerMinute: 4,
  },

  async deals(query, ctx) {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const res = await ctx.fetch(FEED);
      if (!res.ok) throw new Error(`OzBargain answered ${res.status}`);
      cache = { at: Date.now(), items: parseOzBargainFeed(await res.text()) };
    }
    return cache.items.filter((d) => dealMatches(d.title, query)).slice(0, 5);
  },
};
