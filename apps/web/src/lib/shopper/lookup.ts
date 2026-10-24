import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkSourceOffers,
  cleanOfferUrl,
  distanceMetres,
  householdCurrency,
  isSourceApplicable,
  mergeSourceOffers,
  offerMismatch,
  relevantOffers,
  parseSourceIds,
  sortOffers,
  sourceCacheKey,
  storeKey,
  todayISO,
  wantQuery,
  type Group,
  type ShopperSourceCapability,
  type ShopperSourceManifest,
  type ShopperWant,
  type SourceDeal,
  type SourceOffer,
  type SourceQueryContext,
} from "@homeup/core";
import { resolveServerKey } from "@/lib/admin-config";
import { allSources, type ShopperSource, type SourceCallContext } from "./sources";

// HOUP-434: runs a want through every Shopper source that applies to its
// household and stores what they find. Offers and snapshots are written with
// the service role (members can only read them), so callers check the user
// belongs to the want's household first.

const FETCH_TIMEOUT_MS = 12_000;
/**
 * A source that gives the same results as another, cheaper one: it is left
 * out while the cheaper one is ready, so a server with both keys pays once.
 */
const CHEAPER_TWIN: Record<string, string> = { "serpapi-google-shopping": "serper-google-shopping" };

/** Store branches looked up per check, cheapest offers first. */
const STORE_LOOKUPS = 5;

// Per-source call times in the last minute, for each manifest's ratePerMinute.
const recentCalls = new Map<string, number[]>();

function rateLimitedFetch(manifest: ShopperSourceManifest) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const now = Date.now();
    const calls = (recentCalls.get(manifest.id) ?? []).filter((t) => now - t < 60_000);
    if (calls.length >= manifest.ratePerMinute) throw new Error(`${manifest.name} is busy; try again in a minute.`);
    calls.push(now);
    recentCalls.set(manifest.id, calls);
    return fetch(url, {
      ...init,
      headers: { "User-Agent": "Rooftap/1.0 (household shopping list)", ...init?.headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  };
}

/** The household's context for source calls. Location is rounded to about a suburb. */
export function sourceContext(group: Pick<Group, "region" | "currency" | "home_lat" | "home_lng">): SourceQueryContext {
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    region: (group.region || "AU").toUpperCase(),
    currency: householdCurrency(group),
    near: group.home_lat != null && group.home_lng != null ? { lat: round(group.home_lat), lng: round(group.home_lng) } : null,
  };
}

interface ReadySource {
  source: ShopperSource;
  ctx: SourceCallContext;
}

/** The sources a household switched off in Settings > Shopper (HOUP-437). */
export function householdDisabledSources(group: Pick<Group, "shopper_disabled_sources">): Set<string> {
  return new Set(group.shopper_disabled_sources ?? []);
}

/**
 * Sources that apply to this household, with their keys resolved. Pass the
 * household's switched-off sources to leave those out too; Settings leaves
 * them in so they can be switched back on.
 */
export async function applicableSources(
  ctx: SourceQueryContext,
  capability?: ShopperSourceCapability,
  disabledByHousehold?: ReadonlySet<string>,
): Promise<ReadySource[]> {
  const disabledByServer = parseSourceIds(process.env.SHOPPER_SOURCES_DISABLED);
  const ready: ReadySource[] = [];
  for (const source of allSources()) {
    const { manifest } = source;
    if (capability && !manifest.capabilities.includes(capability)) continue;
    const keys: Record<string, string> = {};
    for (const name of manifest.env) {
      const value = await resolveServerKey(name);
      if (value) keys[name] = value;
    }
    if (!isSourceApplicable(manifest, { region: ctx.region, configuredKeys: new Set(Object.keys(keys)), disabledByServer, disabledByHousehold })) continue;
    ready.push({ source, ctx: { ...ctx, keys, fetch: rateLimitedFetch(manifest) } });
  }
  const ids = new Set(ready.map((r) => r.source.manifest.id));
  return ready.filter((r) => !ids.has(CHEAPER_TWIN[r.source.manifest.id] ?? ""));
}

/** Applicable sources' manifests, for attribution in the apps and the Settings switches. */
export async function applicableManifests(ctx: SourceQueryContext): Promise<ShopperSourceManifest[]> {
  return (await applicableSources(ctx)).map((s) => s.source.manifest);
}

type FoundOffer = SourceOffer & { source_id: string; distance_m: number | null };

export interface LookupResult {
  offers: number;
  sources: string[];
  /** Sources that failed this time, by name, so the app can say so. */
  failed: string[];
}

export async function runLookup(admin: SupabaseClient, want: ShopperWant, group: Group): Promise<LookupResult> {
  const ctx = sourceContext(group);
  const off = householdDisabledSources(group);
  const query = wantQuery(want);
  const offerSources = await applicableSources(ctx, "offers", off);
  const failed: string[] = [];

  const found: FoundOffer[] = [];
  await Promise.all(
    offerSources.map(async ({ source, ctx: callCtx }) => {
      try {
        const raw = await cachedOffers(admin, source, query, callCtx);
        for (const o of raw) {
          const offer = { ...o, url: cleanOfferUrl(o.url) };
          // A result that breaks the contract is dropped, never shown.
          if (checkSourceOffers([offer], ctx).length) continue;
          found.push({ ...offer, source_id: source.manifest.id, distance_m: null });
        }
      } catch (err) {
        console.warn(`shopper source ${source.manifest.id} failed:`, err instanceof Error ? err.message : err);
        failed.push(source.manifest.name);
      }
    }),
  );

  // Only the thing itself counts: no cables "for LG C5", no LG fridges.
  const relevant = relevantOffers(query, found, { referenceCents: want.target_cents ?? want.budget_cents });
  const merged = sortOffers(mergeSourceOffers(relevant));
  await addDistances(merged, ctx, off);

  const now = new Date().toISOString();
  const today = todayISO();

  // Replace this want's source offers; manual offers stay until removed. With
  // no source to ask, old prices stay rather than vanish, unless the household
  // switched sources off, which says it doesn't want theirs any more.
  if (offerSources.length || off.size) {
    await admin
      .from("shopper_offers")
      .update({ deleted: true })
      .eq("want_id", want.id)
      .neq("source_id", "manual")
      .eq("deleted", false);
    // Today's point is this check's, so a re-check replaces it (and clears
    // anything an earlier, less careful check counted).
    await admin
      .from("shopper_price_snapshots")
      .update({ deleted: true })
      .eq("want_id", want.id)
      .eq("captured_on", today)
      .neq("source_id", "manual")
      .eq("deleted", false);
  }
  if (merged.length) {
    const { error } = await admin.from("shopper_offers").insert(
      merged.map((o) => ({
        group_id: want.group_id,
        want_id: want.id,
        source_id: o.source_id,
        store: o.store,
        title: o.title,
        url: o.url,
        price_cents: o.price_cents,
        currency: o.currency,
        in_stock: o.in_stock,
        distance_m: o.distance_m,
        checked_at: now,
      })),
    );
    if (error) throw new Error(`Could not save offers: ${error.message}`);
    await saveSnapshots(admin, want, merged, today);
  }

  await refreshBest(admin, want, now);
  return { offers: merged.length, sources: offerSources.map((s) => s.source.manifest.name), failed };
}

/**
 * A source's offers for a query, shared across households: one search per
 * item, region and day (shopper_source_cache). A cache that can't be read
 * or written only costs a fresh search.
 */
async function cachedOffers(admin: SupabaseClient, source: ShopperSource, query: string, ctx: SourceCallContext): Promise<SourceOffer[]> {
  if (!source.searchOffers) return [];
  const key = sourceCacheKey(query, ctx.region, ctx.currency);
  const day = todayISO();
  const { data } = await admin
    .from("shopper_source_cache")
    .select("offers")
    .eq("source_id", source.manifest.id)
    .eq("key", key)
    .eq("day", day)
    .maybeSingle();
  const hit = (data as { offers?: unknown } | null)?.offers;
  if (Array.isArray(hit)) return hit as SourceOffer[];
  const offers = await source.searchOffers(query, ctx);
  const { error } = await admin
    .from("shopper_source_cache")
    .upsert({ source_id: source.manifest.id, key, day, offers }, { onConflict: "source_id,key,day" });
  if (error) console.warn("shopper cache not saved:", error.message);
  return offers;
}

/** Clears shared results older than a few days (the daily price check calls it). */
export async function pruneSourceCache(admin: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await admin.from("shopper_source_cache").delete().lt("day", cutoff);
}

/** A price the household found themselves, kept as a manual offer. */
export async function addManualOffer(
  admin: SupabaseClient,
  want: ShopperWant,
  group: Group,
  input: { store: string; price_cents: number; url: string | null; in_stock: boolean | null },
): Promise<void> {
  const ctx = sourceContext(group);
  const offer: FoundOffer = {
    store: input.store.trim(),
    title: want.title,
    url: cleanOfferUrl(input.url),
    price_cents: input.price_cents,
    currency: ctx.currency,
    in_stock: input.in_stock,
    source_id: "manual",
    distance_m: null,
  };
  await addDistances([offer], ctx, householdDisabledSources(group));
  const now = new Date().toISOString();
  // One manual offer per store: a new price replaces the old one.
  await admin
    .from("shopper_offers")
    .update({ deleted: true })
    .eq("want_id", want.id)
    .eq("source_id", "manual")
    .eq("store", offer.store)
    .eq("deleted", false);
  const { error } = await admin.from("shopper_offers").insert({
    group_id: want.group_id,
    want_id: want.id,
    source_id: "manual",
    store: offer.store,
    title: offer.title,
    url: offer.url,
    price_cents: offer.price_cents,
    currency: offer.currency,
    in_stock: offer.in_stock,
    distance_m: offer.distance_m,
    checked_at: now,
  });
  if (error) throw new Error(`Could not save the price: ${error.message}`);
  await saveSnapshots(admin, want, [offer], todayISO());
  await refreshBest(admin, want, want.last_checked_at ?? now);
}

/** Deals from every applicable deals source, newest first. */
export async function findDeals(want: ShopperWant, group: Group): Promise<(SourceDeal & { source: string })[]> {
  const ctx = sourceContext(group);
  const out: (SourceDeal & { source: string })[] = [];
  for (const { source, ctx: callCtx } of await applicableSources(ctx, "deals", householdDisabledSources(group))) {
    try {
      for (const d of (await source.deals?.(wantQuery(want), callCtx)) ?? []) {
        if (offerMismatch(wantQuery(want), d.title) === null) out.push({ ...d, source: source.manifest.attribution });
      }
    } catch (err) {
      console.warn(`shopper deals source ${source.manifest.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return out.sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
}

async function addDistances(offers: FoundOffer[], ctx: SourceQueryContext, off: ReadonlySet<string>): Promise<void> {
  const near = ctx.near;
  if (!near) return;
  const storeSources = await applicableSources(ctx, "stores", off);
  if (!storeSources.length) return;
  const names = Array.from(new Set(offers.map((o) => o.store))).slice(0, STORE_LOOKUPS);
  const nearest = new Map<string, number>();
  for (const name of names) {
    for (const { source, ctx: callCtx } of storeSources) {
      try {
        const [first] = (await source.nearbyStores?.(name, callCtx)) ?? [];
        if (first) {
          nearest.set(storeKey(name), distanceMetres(near, first));
          break;
        }
      } catch {
        // No distance is fine; the store still shows.
      }
    }
  }
  for (const o of offers) o.distance_m = nearest.get(storeKey(o.store)) ?? o.distance_m;
}

async function saveSnapshots(admin: SupabaseClient, want: ShopperWant, offers: FoundOffer[], day: string): Promise<void> {
  const { error } = await admin.from("shopper_price_snapshots").upsert(
    offers.map((o) => ({
      group_id: want.group_id,
      want_id: want.id,
      source_id: o.source_id,
      store: o.store,
      price_cents: o.price_cents,
      currency: o.currency,
      captured_on: day,
      deleted: false,
    })),
    { onConflict: "want_id,source_id,store,captured_on" },
  );
  if (error) console.warn("shopper snapshots not saved:", error.message);
}

/** Recomputes the want's cheapest live offer from the table. */
async function refreshBest(admin: SupabaseClient, want: ShopperWant, checkedAt: string): Promise<void> {
  const { data } = await admin
    .from("shopper_offers")
    .select("store, price_cents")
    .eq("want_id", want.id)
    .eq("deleted", false)
    .order("price_cents", { ascending: true })
    .limit(1);
  const best = data?.[0];
  await admin
    .from("shopper_wants")
    .update({ best_cents: best?.price_cents ?? null, best_store: best?.store ?? null, last_checked_at: checkedAt })
    .eq("id", want.id);
}
