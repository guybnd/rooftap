import { priceTextToCents, type SourceOffer } from "@homeup/core";
import type { ShopperSource } from "./types";

// Google Shopping results through Serper (https://serper.dev), about a tenth
// of SerpApi's price per search. Same data as serpapi-google-shopping, so the
// lookup skips that one when this one has a key (CHEAPER_TWIN in lookup.ts).

interface SerperShoppingResult {
  title?: string;
  source?: string;
  link?: string;
  price?: string | number;
}

export const serperGoogleShopping: ShopperSource = {
  manifest: {
    id: "serper-google-shopping",
    name: "Google Shopping",
    regions: "*",
    capabilities: ["offers"],
    kind: "api",
    env: ["SERPER_API_KEY"],
    attribution: "Google Shopping via Serper",
    homepage: "https://serper.dev",
    ratePerMinute: 60,
  },

  async searchOffers(query, ctx) {
    const res = await ctx.fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "X-API-KEY": ctx.keys.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: ctx.region.toLowerCase(), hl: "en", num: 20 }),
    });
    if (!res.ok) throw new Error(`Serper answered ${res.status}`);
    const body = (await res.json()) as { shopping?: SerperShoppingResult[] };
    const offers: SourceOffer[] = [];
    for (const r of body.shopping ?? []) {
      const price = priceTextToCents(r.price ?? null);
      if (!price || !r.source || !r.title) continue;
      offers.push({
        store: r.source,
        title: r.title,
        url: r.link ?? null,
        price_cents: price,
        // Google Shopping prices in the gl region's currency.
        currency: ctx.currency,
        in_stock: null,
      });
    }
    return offers;
  },
};
