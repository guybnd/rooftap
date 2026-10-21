import {
  checkSourceDeals,
  checkSourceStores,
  parseHttpSources,
  type HttpSourceConfig,
  type SourceDeal,
  type SourceOffer,
  type SourceStore,
} from "@homeup/core";
import type { ShopperSource, SourceCallContext } from "./types";

// HOUP-437: a source that runs outside Rooftap. The server operator lists
// connectors in SHOPPER_HTTP_SOURCES and each one answers three JSON calls
// that mirror the in-repo interface, so a regional connector can be written
// in any language and added without a pull request or an app update. The
// API is documented in .docs/shopper-sources.md. What comes back is checked
// like any source's: offers by the lookup, stores and deals here, and
// anything off-contract is dropped rather than shown.

async function post<T>(config: HttpSourceConfig, path: string, payload: unknown, ctx: SourceCallContext): Promise<T> {
  const res = await ctx.fetch(`${config.url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${config.manifest.name} answered ${res.status}`);
  return (await res.json()) as T;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function createHttpSource(config: HttpSourceConfig): ShopperSource {
  const { manifest } = config;
  const has = (c: string) => manifest.capabilities.includes(c as never);
  return {
    manifest,
    searchOffers: has("offers")
      ? async (query, ctx) => {
          const body = await post<{ offers?: unknown }>(config, "/offers", { query, region: ctx.region, currency: ctx.currency, near: ctx.near }, ctx);
          return list<SourceOffer>(body.offers);
        }
      : undefined,
    nearbyStores: has("stores")
      ? async (storeName, ctx) => {
          if (!ctx.near) return [];
          const body = await post<{ stores?: unknown }>(config, "/stores", { store: storeName, region: ctx.region, near: ctx.near }, ctx);
          return list<SourceStore>(body.stores).filter((s) => checkSourceStores([s]).length === 0);
        }
      : undefined,
    deals: has("deals")
      ? async (query, ctx) => {
          const body = await post<{ deals?: unknown }>(config, "/deals", { query, region: ctx.region, currency: ctx.currency }, ctx);
          return list<SourceDeal>(body.deals).filter((d) => checkSourceDeals([d]).length === 0);
        }
      : undefined,
  };
}

let cached: { raw: string | undefined; sources: ShopperSource[] } | null = null;

/** The external sources this server is configured with, parsed once per value of the env var. */
export function httpSources(raw: string | undefined = process.env.SHOPPER_HTTP_SOURCES): ShopperSource[] {
  if (cached && cached.raw === raw) return cached.sources;
  const { sources, problems } = parseHttpSources(raw);
  for (const p of problems) console.warn(`SHOPPER_HTTP_SOURCES: ${p}`);
  cached = { raw, sources: sources.map(createHttpSource) };
  return cached.sources;
}
