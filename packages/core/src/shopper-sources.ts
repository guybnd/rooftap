// Shopper sources (HOUP-434): every place Shopper gets prices, stock, stores
// or deals from is a source behind this contract, so a contributor can add a
// regional one without touching the rest of the module. Only the shapes and
// the pure rules live here; implementations are server-only, in
// apps/web/src/lib/shopper/sources/ (they hold API keys and fetch). A source
// may also live outside the repo entirely, behind the external HTTP source
// (HOUP-437), which speaks these same shapes as JSON.

export type ShopperSourceCapability = 'offers' | 'stores' | 'deals';

export interface ShopperSourceManifest {
  /** Stable id, kebab-case. Stored on every offer and snapshot it produces. */
  id: string;
  name: string;
  /** ISO 3166 country codes this source covers, or '*' for anywhere. */
  regions: readonly string[] | '*';
  capabilities: readonly ShopperSourceCapability[];
  /** How it gets data: an official API, a public feed, or a single page read on demand. */
  kind: 'api' | 'feed' | 'page';
  /** Server keys it needs (resolveServerKey names). Missing any = the source is off. */
  env: readonly string[];
  /** Shown under every number the source supplies, e.g. "Google Shopping via SerpApi". */
  attribution: string;
  homepage: string;
  /** Calls per minute this server may make; the fetch wrapper enforces it. */
  ratePerMinute: number;
}

/** What a source returns for an offers search. Money in minor units. */
export interface SourceOffer {
  store: string;
  title: string;
  url: string | null;
  price_cents: number;
  currency: string;
  in_stock: boolean | null;
  /** Where the store is, when known, so the server can work out distance. */
  location?: { lat: number; lng: number } | null;
}

export interface SourceStore {
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  /** e.g. "Open until 9pm", as the source words it. */
  hours: string | null;
}

export interface SourceDeal {
  title: string;
  url: string;
  price_cents: number | null;
  currency: string | null;
  posted_at: string | null;
}

/** Context the server hands every call. */
export interface SourceQueryContext {
  /** ISO country code of the household (groups.region). */
  region: string;
  currency: string;
  /** The household's rough location, when the app shared one; never more precise than a suburb. */
  near: { lat: number; lng: number } | null;
}

/**
 * Whether a source applies to a household: it covers the region, the server
 * has its keys, the operator hasn't disabled it, and the household hasn't
 * switched it off.
 */
export function isSourceApplicable(
  manifest: Pick<ShopperSourceManifest, 'id' | 'regions' | 'env'>,
  input: {
    region: string;
    configuredKeys: ReadonlySet<string>;
    disabledByServer?: ReadonlySet<string>;
    disabledByHousehold?: ReadonlySet<string>;
  },
): boolean {
  if (input.disabledByServer?.has(manifest.id)) return false;
  if (input.disabledByHousehold?.has(manifest.id)) return false;
  if (manifest.regions !== '*' && !manifest.regions.includes(input.region.toUpperCase())) return false;
  return manifest.env.every((k) => input.configuredKeys.has(k));
}

/** Parses a comma-separated list of source ids (SHOPPER_SOURCES_DISABLED, group setting). */
export function parseSourceIds(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Great-circle distance in metres. */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Store names compared loosely, so "JB Hi-Fi" and "JB HI-FI " are one store. */
export function storeKey(store: string): string {
  return store.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Merges offers from several sources: one per store (the cheapest), so the
 * same store found by two sources shows once. Order is left to sortOffers.
 */
export function mergeSourceOffers<T extends Pick<SourceOffer, 'store' | 'price_cents'>>(offers: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const o of offers) {
    const key = storeKey(o.store);
    const prev = best.get(key);
    if (!prev || o.price_cents < prev.price_cents) best.set(key, o);
  }
  return Array.from(best.values());
}

/**
 * The conformance rules every source's output must meet (the shared test
 * suite runs this over recorded fixtures). Returns the problems found; an
 * empty list passes. Results in another currency than the household's are a
 * problem: sources must not hand back prices the household can't compare.
 */
export function checkSourceOffers(offers: readonly SourceOffer[], ctx: Pick<SourceQueryContext, 'currency'>): string[] {
  const problems: string[] = [];
  offers.forEach((o, i) => {
    const at = `offer ${i} (${o.store || 'no store'})`;
    if (!o.store?.trim()) problems.push(`${at}: store is empty`);
    if (!o.title?.trim()) problems.push(`${at}: title is empty`);
    if (!Number.isInteger(o.price_cents) || o.price_cents <= 0) problems.push(`${at}: price_cents must be a positive integer`);
    if (o.currency !== ctx.currency) problems.push(`${at}: currency ${o.currency} is not ${ctx.currency}`);
    if (o.url != null && !/^https:\/\//.test(o.url)) problems.push(`${at}: url must be https`);
    if (o.url && /[?&](utm_|aff|affiliate|ref=|tag=)/i.test(o.url)) problems.push(`${at}: url carries tracking or affiliate parameters`);
  });
  return problems;
}

/** Strips tracking parameters from a product URL (no affiliate rewriting, ever). */
export function cleanOfferUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|aff|affiliate|ref$|tag$|gclid|fbclid|srsltid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Parses a price string a source scraped or received ("$1,799.00", "A$ 899") into cents. */
export function priceTextToCents(text: string | number | null | undefined): number | null {
  if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? Math.round(text * 100) : null;
  if (!text) return null;
  const match = String(text).replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? Math.round(n * 100) : null;
}
