import { describe, expect, it } from "vitest";
import { checkSourceOffers } from "@homeup/core";
import { SHOPPER_SOURCES } from "./index";
import { serpapiGoogleShopping } from "./serpapi-google-shopping";
import { osmStores } from "./osm-stores";
import { dealMatches, ozbargain, parseOzBargainFeed } from "./ozbargain";
import type { SourceCallContext } from "./types";

// HOUP-434: the conformance suite every Shopper source runs against recorded
// responses. No network: each test hands the source a fetch that replays a
// fixture. A new source adds its own block here (.docs/shopper-sources.md).

function ctxWith(body: unknown, overrides: Partial<SourceCallContext> = {}): SourceCallContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    region: "AU",
    currency: "AUD",
    near: { lat: -37.88, lng: 145.08 },
    keys: { SERPAPI_API_KEY: "test-key" },
    calls,
    fetch: async (url: string) => {
      calls.push(url);
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
    },
    ...overrides,
  };
}

describe("source registry", () => {
  it("has unique kebab-case ids and implements every capability it claims", () => {
    const ids = SHOPPER_SOURCES.map((s) => s.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHOPPER_SOURCES) {
      expect(s.manifest.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.manifest.id).not.toBe("manual");
      expect(s.manifest.attribution.trim()).not.toBe("");
      expect(s.manifest.ratePerMinute).toBeGreaterThan(0);
      if (s.manifest.capabilities.includes("offers")) expect(s.searchOffers).toBeTypeOf("function");
      if (s.manifest.capabilities.includes("stores")) expect(s.nearbyStores).toBeTypeOf("function");
      if (s.manifest.capabilities.includes("deals")) expect(s.deals).toBeTypeOf("function");
    }
  });
});

describe("serpapi-google-shopping", () => {
  const fixture = {
    shopping_results: [
      { title: "Sony Bravia 7 65\" K-65XR70", source: "JB Hi-Fi", link: "https://www.jbhifi.com.au/products/sony-bravia-7", extracted_price: 1795 },
      { title: "Sony Bravia 7 65 inch", source: "The Good Guys", product_link: "https://www.google.com/shopping/product/1", price: "$1,849.00" },
      { title: "No price", source: "Somewhere" },
      { title: "No store", extracted_price: 10 },
    ],
  };

  it("maps results to offers that pass the contract", async () => {
    const ctx = ctxWith(fixture);
    const offers = await serpapiGoogleShopping.searchOffers!("Sony Bravia 7 65", ctx);
    expect(offers.map((o) => [o.store, o.price_cents])).toEqual([
      ["JB Hi-Fi", 179500],
      ["The Good Guys", 184900],
    ]);
    expect(checkSourceOffers(offers, ctx)).toEqual([]);
    expect(ctx.calls[0]).toContain("engine=google_shopping");
    expect(ctx.calls[0]).toContain("gl=au");
  });
});

describe("osm-stores", () => {
  it("returns branches nearest first, and nothing without a location", async () => {
    const fixture = {
      elements: [
        { type: "node", lat: -37.95, lon: 145.05, tags: { name: "JB Hi-Fi", "addr:suburb": "Moorabbin" } },
        { type: "way", center: { lat: -37.886, lon: 145.083 }, tags: { brand: "JB Hi-Fi", "addr:street": "Dandenong Road", "addr:housenumber": "1341" } },
      ],
    };
    const stores = await osmStores.nearbyStores!("JB Hi-Fi", ctxWith(fixture));
    expect(stores.map((s) => s.address)).toEqual(["1341 Dandenong Road", "Moorabbin"]);
    expect(await osmStores.nearbyStores!("JB Hi-Fi", ctxWith(fixture, { near: null }))).toEqual([]);
  });
});

describe("ozbargain", () => {
  const feed = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Sony Bravia 7 65" $1,695 Delivered @ JB Hi-Fi]]></title><link>https://www.ozbargain.com.au/node/900001</link><pubDate>Mon, 20 Oct 2026 09:00:00 +1100</pubDate></item>
    <item><title>Free Coffee &amp; Cake @ Somewhere</title><link>https://www.ozbargain.com.au/node/900002</link></item>
  </channel></rss>`;

  it("parses the feed and pulls a price from the title", () => {
    const deals = parseOzBargainFeed(feed);
    expect(deals[0]).toMatchObject({ price_cents: 169500, currency: "AUD", url: "https://www.ozbargain.com.au/node/900001" });
    expect(deals[1]).toMatchObject({ title: "Free Coffee & Cake @ Somewhere", price_cents: null });
  });

  it("matches deals that carry every word of the query", async () => {
    expect(dealMatches('Sony Bravia 7 65" $1,695', "Sony Bravia 7 65")).toBe(true);
    expect(dealMatches("Sony headphones", "Sony Bravia")).toBe(false);
    const deals = await ozbargain.deals!("bravia 65", ctxWith(feed));
    expect(deals).toHaveLength(1);
  });
});
