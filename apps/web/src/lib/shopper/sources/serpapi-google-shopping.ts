import { priceTextToCents, type SourceOffer } from "@homeup/core";
import type { ShopperSource } from "./types";

// Google Shopping results through SerpApi (https://serpapi.com/google-shopping-api).
// Covers any region Google Shopping does; `gl` is the household's region.
// Paid per search with a small free tier, so lookups are cached by the caller
// and the daily refresh is the main user.

interface SerpShoppingResult {
  title?: string;
  source?: string;
  link?: string;
  product_link?: string;
  extracted_price?: number;
  price?: string;
}

export const serpapiGoogleShopping: ShopperSource = {
  manifest: {
    id: "serpapi-google-shopping",
    name: "Google Shopping",
    regions: "*",
    capabilities: ["offers"],
    kind: "api",
    env: ["SERPAPI_API_KEY"],
    attribution: "Google Shopping via SerpApi",
    homepage: "https://serpapi.com/google-shopping-api",
    ratePerMinute: 30,
  },

  async searchOffers(query, ctx) {
    const params = new URLSearchParams({
      engine: "google_shopping",
      q: query,
      gl: ctx.region.toLowerCase(),
      hl: "en",
      num: "20",
      api_key: ctx.keys.SERPAPI_API_KEY,
    });
    const res = await ctx.fetch(`https://serpapi.com/search.json?${params}`);
    if (!res.ok) throw new Error(`SerpApi answered ${res.status}`);
    const body = (await res.json()) as { shopping_results?: SerpShoppingResult[] };
    const offers: SourceOffer[] = [];
    for (const r of body.shopping_results ?? []) {
      const price = priceTextToCents(r.extracted_price ?? r.price ?? null);
      if (!price || !r.source || !r.title) continue;
      offers.push({
        store: r.source,
        title: r.title,
        url: r.link ?? r.product_link ?? null,
        price_cents: price,
        // Google Shopping prices in the gl region's currency.
        currency: ctx.currency,
        in_stock: null,
      });
    }
    return offers;
  },
};
