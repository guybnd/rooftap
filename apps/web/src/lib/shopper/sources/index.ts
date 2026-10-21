import type { ShopperSource } from "./types";
import { serpapiGoogleShopping } from "./serpapi-google-shopping";
import { osmStores } from "./osm-stores";
import { ozbargain } from "./ozbargain";

// HOUP-434: every Shopper source the server knows. Adding one is a new file in
// this folder plus a line here (.docs/shopper-sources.md); nothing else
// changes. Which apply to a household is decided per lookup (region, keys,
// SHOPPER_SOURCES_DISABLED), see ../lookup.ts.
export const SHOPPER_SOURCES: readonly ShopperSource[] = [serpapiGoogleShopping, osmStores, ozbargain];

export type { ShopperSource, SourceCallContext } from "./types";
