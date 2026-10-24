import type { ShopperSource } from "./types";
import { serpapiGoogleShopping } from "./serpapi-google-shopping";
import { serperGoogleShopping } from "./serper-google-shopping";
import { osmStores } from "./osm-stores";
import { ozbargain } from "./ozbargain";
import { httpSources } from "./http-source";

// HOUP-434: every Shopper source the server knows. Adding one is a new file in
// this folder plus a line here (.docs/shopper-sources.md); nothing else
// changes. Which apply to a household is decided per lookup (region, keys,
// SHOPPER_SOURCES_DISABLED), see ../lookup.ts.
export const SHOPPER_SOURCES: readonly ShopperSource[] = [serperGoogleShopping, serpapiGoogleShopping, osmStores, ozbargain];

/**
 * The built-in sources plus any external ones the operator configured
 * (SHOPPER_HTTP_SOURCES, HOUP-437). An external source whose id clashes with
 * a built-in one is left out.
 */
export function allSources(): readonly ShopperSource[] {
  const builtIn = new Set(SHOPPER_SOURCES.map((s) => s.manifest.id));
  return [...SHOPPER_SOURCES, ...httpSources().filter((s) => !builtIn.has(s.manifest.id))];
}

export type { ShopperSource, SourceCallContext } from "./types";
