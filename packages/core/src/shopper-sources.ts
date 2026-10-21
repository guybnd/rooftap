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

const SOURCE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CAPABILITIES: readonly ShopperSourceCapability[] = ['offers', 'stores', 'deals'];

/** The manifest rules (HOUP-437): what review and the registry test check before a source ships. */
export function checkSourceManifest(manifest: ShopperSourceManifest): string[] {
  const problems: string[] = [];
  const at = `source ${manifest.id || 'no id'}`;
  if (!SOURCE_ID.test(manifest.id ?? '')) problems.push(`${at}: id must be kebab-case`);
  if (manifest.id === 'manual') problems.push(`${at}: "manual" is reserved for prices people add`);
  if (!manifest.name?.trim()) problems.push(`${at}: name is empty`);
  if (!manifest.attribution?.trim()) problems.push(`${at}: attribution is empty`);
  if (manifest.regions !== '*' && (!Array.isArray(manifest.regions) || !manifest.regions.length || manifest.regions.some((r) => !/^[A-Z]{2}$/.test(r)))) {
    problems.push(`${at}: regions must be '*' or two-letter upper-case country codes`);
  }
  if (!manifest.capabilities?.length || manifest.capabilities.some((c) => !CAPABILITIES.includes(c))) {
    problems.push(`${at}: capabilities must be some of ${CAPABILITIES.join(', ')}`);
  }
  if (!['api', 'feed', 'page'].includes(manifest.kind)) problems.push(`${at}: kind must be api, feed or page`);
  if (!(manifest.ratePerMinute > 0)) problems.push(`${at}: ratePerMinute must be above 0`);
  if (manifest.kind === 'page' && manifest.ratePerMinute > 10) problems.push(`${at}: a page source may make at most 10 calls a minute`);
  return problems;
}

export function checkSourceStores(stores: readonly SourceStore[]): string[] {
  const problems: string[] = [];
  stores.forEach((s, i) => {
    const at = `store ${i} (${s.name || 'no name'})`;
    if (!s.name?.trim()) problems.push(`${at}: name is empty`);
    if (!Number.isFinite(s.lat) || Math.abs(s.lat) > 90 || !Number.isFinite(s.lng) || Math.abs(s.lng) > 180) {
      problems.push(`${at}: lat and lng must be real coordinates`);
    }
  });
  return problems;
}

export function checkSourceDeals(deals: readonly SourceDeal[]): string[] {
  const problems: string[] = [];
  deals.forEach((d, i) => {
    const at = `deal ${i}`;
    if (!d.title?.trim()) problems.push(`${at}: title is empty`);
    if (!/^https:\/\//.test(d.url ?? '')) problems.push(`${at}: url must be https`);
    if (d.price_cents != null && (!Number.isInteger(d.price_cents) || d.price_cents <= 0)) problems.push(`${at}: price_cents must be a positive integer or null`);
    if (d.posted_at != null && Number.isNaN(Date.parse(d.posted_at))) problems.push(`${at}: posted_at must be an ISO date or null`);
  });
  return problems;
}

/**
 * One external HTTP source (HOUP-437): a connector that runs outside Rooftap,
 * in any language, and answers the same shapes as JSON. Configured by the
 * server operator in SHOPPER_HTTP_SOURCES (.docs/shopper-sources.md).
 */
export interface HttpSourceConfig {
  /** Base URL; the server POSTs to `${url}/offers`, `/stores` and `/deals`. */
  url: string;
  /** Sent as `Authorization: Bearer <token>` when set. */
  token: string | null;
  manifest: ShopperSourceManifest;
}

/**
 * Reads SHOPPER_HTTP_SOURCES (a JSON list of `{ url, token?, manifest }`).
 * An entry with a bad URL or manifest is left out and reported, so one typo
 * doesn't take the other sources down. `kind` defaults to 'api', `env` to
 * none and `ratePerMinute` to 30.
 */
export function parseHttpSources(raw: string | null | undefined): { sources: HttpSourceConfig[]; problems: string[] } {
  const sources: HttpSourceConfig[] = [];
  const problems: string[] = [];
  if (!raw?.trim()) return { sources, problems };
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return { sources, problems: ['SHOPPER_HTTP_SOURCES is not valid JSON'] };
  }
  if (!Array.isArray(list)) return { sources, problems: ['SHOPPER_HTTP_SOURCES must be a JSON list'] };
  list.forEach((entry, i) => {
    const e = (entry ?? {}) as { url?: unknown; token?: unknown; manifest?: Partial<ShopperSourceManifest> };
    let url: URL | null = null;
    try {
      url = typeof e.url === 'string' ? new URL(e.url) : null;
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      problems.push(`entry ${i}: url must be an http(s) URL`);
      return;
    }
    const m = e.manifest ?? {};
    const manifest: ShopperSourceManifest = {
      id: String(m.id ?? ''),
      name: String(m.name ?? ''),
      regions: m.regions === '*' ? '*' : Array.isArray(m.regions) ? m.regions.map((r) => String(r).toUpperCase()) : [],
      capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
      kind: m.kind ?? 'api',
      env: [],
      attribution: String(m.attribution ?? ''),
      homepage: String(m.homepage ?? url.origin),
      ratePerMinute: typeof m.ratePerMinute === 'number' ? m.ratePerMinute : 30,
    };
    const bad = checkSourceManifest(manifest);
    if (bad.length) {
      problems.push(...bad.map((p) => `entry ${i}: ${p}`));
      return;
    }
    if (sources.some((s) => s.manifest.id === manifest.id)) {
      problems.push(`entry ${i}: source ${manifest.id} is listed twice`);
      return;
    }
    sources.push({ url: url.toString().replace(/\/+$/, ''), token: typeof e.token === 'string' && e.token ? e.token : null, manifest });
  });
  return { sources, problems };
}

const CAPABILITY_WORDS: Record<ShopperSourceCapability, string> = {
  offers: 'prices',
  stores: 'nearby stores',
  deals: 'shared deals',
};

/** What a source gives, in words for Settings > Shopper ("Prices and nearby stores"). */
export function sourceCapabilityLabel(capabilities: readonly string[]): string {
  const words = CAPABILITY_WORDS as Record<string, string>;
  const known = capabilities.filter((c) => c in words).map((c) => words[c]);
  if (!known.length) return '';
  const text = known.length === 1 ? known[0] : `${known.slice(0, -1).join(', ')} and ${known[known.length - 1]}`;
  return text[0].toUpperCase() + text.slice(1);
}
