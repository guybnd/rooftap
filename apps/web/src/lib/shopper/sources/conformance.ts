import {
  checkSourceDeals,
  checkSourceManifest,
  checkSourceOffers,
  checkSourceStores,
  type SourceDeal,
  type SourceOffer,
  type SourceQueryContext,
  type SourceStore,
} from "@homeup/core";
import type { ShopperSource, SourceCallContext } from "./types";

// HOUP-437: the conformance suite every Shopper source runs in its test, with
// no network. Each fixture is the body the source's API, feed or page answers
// with (an object is sent as JSON, a string as-is); the helper replays it to
// every fetch the call makes and checks what the source returns against the
// contract. See .docs/shopper-sources.md for a worked example.

export interface SourceFixture {
  /** The search words (offers, deals) or store name (stores) to call with. */
  input: string;
  body: unknown;
  status?: number;
}

export interface ConformanceFixtures {
  offers?: SourceFixture;
  stores?: SourceFixture;
  deals?: SourceFixture;
  /** The household to call as. Defaults to an Australian one near Melbourne. */
  ctx?: Partial<SourceQueryContext>;
  /** Server keys to hand the source; every manifest.env name gets "test-key" unless given. */
  keys?: Record<string, string>;
}

export interface ConformanceResult {
  /** Empty when the source passes. */
  problems: string[];
  offers: SourceOffer[];
  stores: SourceStore[];
  deals: SourceDeal[];
  /** Every URL the source fetched, for asserting on query parameters. */
  calls: string[];
}

function replay(fixture: SourceFixture, calls: string[]): SourceCallContext["fetch"] {
  return async (url: string) => {
    calls.push(url);
    const body = typeof fixture.body === "string" ? fixture.body : JSON.stringify(fixture.body);
    return new Response(body, { status: fixture.status ?? 200 });
  };
}

export async function runSourceConformance(source: ShopperSource, fixtures: ConformanceFixtures): Promise<ConformanceResult> {
  const { manifest } = source;
  const problems = checkSourceManifest(manifest);
  const calls: string[] = [];
  const base: SourceQueryContext = { region: "AU", currency: "AUD", near: { lat: -37.88, lng: 145.08 }, ...fixtures.ctx };
  const keys = Object.fromEntries(manifest.env.map((k) => [k, fixtures.keys?.[k] ?? "test-key"]));
  const ctxFor = (fixture: SourceFixture): SourceCallContext => ({ ...base, keys, fetch: replay(fixture, calls) });
  const result: ConformanceResult = { problems, offers: [], stores: [], deals: [], calls };

  for (const capability of manifest.capabilities) {
    const method = capability === "offers" ? source.searchOffers : capability === "stores" ? source.nearbyStores : source.deals;
    if (typeof method !== "function") problems.push(`${manifest.id}: claims ${capability} but doesn't implement it`);
    else if (!fixtures[capability]) problems.push(`${manifest.id}: no ${capability} fixture to test it with`);
  }

  try {
    if (fixtures.offers && source.searchOffers) {
      result.offers = await source.searchOffers(fixtures.offers.input, ctxFor(fixtures.offers));
      problems.push(...checkSourceOffers(result.offers, base));
      if (!result.offers.length) problems.push(`${manifest.id}: returned no offers from its fixture`);
    }
    if (fixtures.stores && source.nearbyStores) {
      result.stores = await source.nearbyStores(fixtures.stores.input, ctxFor(fixtures.stores));
      problems.push(...checkSourceStores(result.stores));
      if (!result.stores.length) problems.push(`${manifest.id}: returned no stores from its fixture`);
    }
    if (fixtures.deals && source.deals) {
      result.deals = await source.deals(fixtures.deals.input, ctxFor(fixtures.deals));
      problems.push(...checkSourceDeals(result.deals));
      if (!result.deals.length) problems.push(`${manifest.id}: returned no deals from its fixture`);
    }
  } catch (err) {
    problems.push(`${manifest.id}: threw on its fixture: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}
