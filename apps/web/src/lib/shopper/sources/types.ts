import type {
  ShopperSourceManifest,
  SourceDeal,
  SourceOffer,
  SourceQueryContext,
  SourceStore,
} from "@homeup/core";

// HOUP-434: the server half of the Shopper source contract (the shapes live in
// packages/core/src/modules/shopper/shopper-sources.ts). A source is one file in this folder
// exporting a ShopperSource, listed once in ./index.ts. It implements only the
// calls its manifest's capabilities name. See .docs/shopper-sources.md.

export interface SourceCallContext extends SourceQueryContext {
  /** The source's server keys, resolved (admin config first, then env). */
  keys: Readonly<Record<string, string>>;
  /** fetch with this source's rate limit, a timeout and Rooftap's user agent. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface ShopperSource {
  manifest: ShopperSourceManifest;
  /** `offers`: what the product costs where, for a search query. */
  searchOffers?(query: string, ctx: SourceCallContext): Promise<SourceOffer[]>;
  /** `stores`: branches of a named store near ctx.near, nearest first. */
  nearbyStores?(storeName: string, ctx: SourceCallContext): Promise<SourceStore[]>;
  /** `deals`: community or retailer deals matching a query. */
  deals?(query: string, ctx: SourceCallContext): Promise<SourceDeal[]>;
}
