import { describe, expect, it } from "vitest";
import { checkSourceManifest, checkSourceOffers } from "@homeup/core";
import { SHOPPER_SOURCES } from "./index";
import { serpapiGoogleShopping } from "./serpapi-google-shopping";
import { osmStores } from "./osm-stores";
import { dealMatches, ozbargain, parseOzBargainFeed } from "./ozbargain";
import type { SourceCallContext } from "./types";
import { runSourceConformance } from "./conformance";
import { createHttpSource, httpSources } from "./http-source";

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
      expect(checkSourceManifest(s.manifest)).toEqual([]);
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

  it("passes the conformance suite", async () => {
    const { problems } = await runSourceConformance(serpapiGoogleShopping, { offers: { input: "Sony Bravia 7 65", body: fixture } });
    expect(problems).toEqual([]);
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

describe("external http source", () => {
  const manifest = {
    id: "pricespy-nz",
    name: "PriceSpy",
    regions: ["NZ"],
    capabilities: ["offers", "stores", "deals"],
    kind: "api",
    env: [],
    attribution: "Prices from PriceSpy",
    homepage: "https://pricespy.co.nz",
    ratePerMinute: 30,
  } as const;
  const config = { url: "https://prices.example.nz", token: "secret", manifest };

  function recording(body: unknown) {
    const requests: { url: string; init?: RequestInit }[] = [];
    const ctx: SourceCallContext = {
      region: "NZ",
      currency: "NZD",
      near: { lat: -36.85, lng: 174.76 },
      keys: {},
      fetch: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(body), { status: 200 });
      },
    };
    return { ctx, requests };
  }

  it("posts the documented request with the bearer token", async () => {
    const source = createHttpSource(config);
    const { ctx, requests } = recording({ offers: [{ store: "Noel Leeming", title: "TV", url: null, price_cents: 199900, currency: "NZD", in_stock: true }] });
    const offers = await source.searchOffers!("sony bravia", ctx);
    expect(offers).toHaveLength(1);
    expect(requests[0].url).toBe("https://prices.example.nz/offers");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ query: "sony bravia", region: "NZ", currency: "NZD", near: { lat: -36.85, lng: 174.76 } });
  });

  it("drops stores and deals that break the contract, and throws on an error status", async () => {
    const source = createHttpSource(config);
    const stores = await source.nearbyStores!("Noel Leeming", recording({ stores: [{ name: "Noel Leeming", lat: -36.9, lng: 174.8, address: null, hours: null }, { name: "", lat: 999, lng: 0 }] }).ctx);
    expect(stores).toHaveLength(1);
    const deals = await source.deals!("tv", recording({ deals: [{ title: "TV deal", url: "http://insecure", price_cents: null, currency: null, posted_at: null }] }).ctx);
    expect(deals).toEqual([]);
    const failing = { ...recording({}).ctx, fetch: async () => new Response("nope", { status: 502 }) };
    await expect(source.searchOffers!("tv", failing)).rejects.toThrow("PriceSpy answered 502");
  });

  it("passes the conformance suite with NZ fixtures", async () => {
    const { problems } = await runSourceConformance(createHttpSource(config), {
      ctx: { region: "NZ", currency: "NZD", near: { lat: -36.85, lng: 174.76 } },
      offers: { input: "tv", body: { offers: [{ store: "Noel Leeming", title: "TV", url: "https://www.noelleeming.co.nz/p/1", price_cents: 199900, currency: "NZD", in_stock: true }] } },
      stores: { input: "Noel Leeming", body: { stores: [{ name: "Noel Leeming", lat: -36.9, lng: 174.8, address: "Newmarket", hours: null }] } },
      deals: { input: "tv", body: { deals: [{ title: "TV deal", url: "https://deals.example.nz/1", price_cents: 189900, currency: "NZD", posted_at: "2026-10-20T00:00:00Z" }] } },
    });
    expect(problems).toEqual([]);
  });

  it("reads the env var once per value and skips bad entries", () => {
    const raw = JSON.stringify([config, { url: "nope", manifest }]);
    const first = httpSources(raw);
    expect(first.map((s) => s.manifest.id)).toEqual(["pricespy-nz"]);
    expect(httpSources(raw)).toBe(first);
    expect(httpSources(undefined)).toEqual([]);
  });
});

describe("conformance suite", () => {
  it("reports a source that claims a capability it has no fixture or code for", async () => {
    const { problems } = await runSourceConformance(ozbargain, {});
    expect(problems.join("\n")).toMatch(/no deals fixture/);
  });
});
