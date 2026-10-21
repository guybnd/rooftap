// HOUP-434: the web app's calls to /api/shopper. Prices land in the synced
// offer and snapshot stores; these calls only start the work and report how
// it went. Native twin: apps/mobile/src/features/shopper/shopper-api.ts.
import type { ScoutBrief, ShopperPick, ShopperSearch, ShopperWant, SourceDeal } from "@homeup/core";

export interface ShopperLookupResult {
  offers: number;
  sources: string[];
  failed: string[];
}

export interface ShopperSourceInfo {
  id: string;
  name: string;
  capabilities: string[];
  attribution: string;
  homepage: string;
  /** The household's Settings > Shopper switch (HOUP-437). */
  enabled: boolean;
}

/** A failed call, with the server's stable code when it sent one (HOUP-436's ai_* codes). */
export class ShopperApiError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ShopperApiError(body.error ?? `Request failed (${res.status})`, body.code ?? null, res.status);
  return body as T;
}

export function lookupWant(wantId: string): Promise<ShopperLookupResult> {
  return call("/api/shopper/lookup", { method: "POST", body: JSON.stringify({ wantId }) });
}

export function addManualPrice(input: { wantId: string; store: string; price_cents: number; url?: string | null }): Promise<void> {
  return call("/api/shopper/offers", { method: "POST", body: JSON.stringify(input) });
}

export function removeManualPrice(wantId: string, offerId: string): Promise<void> {
  return call(`/api/shopper/offers?wantId=${encodeURIComponent(wantId)}&offerId=${encodeURIComponent(offerId)}`, { method: "DELETE" });
}

export async function wantDeals(wantId: string): Promise<(SourceDeal & { source: string })[]> {
  return (await call<{ deals: (SourceDeal & { source: string })[] }>(`/api/shopper/deals?wantId=${encodeURIComponent(wantId)}`)).deals;
}

export async function shopperSources(): Promise<ShopperSourceInfo[]> {
  return (await call<{ sources: ShopperSourceInfo[] }>("/api/shopper/sources")).sources;
}

/** Switches one source on or off for the household (Settings > Shopper). */
export function setSourceEnabled(id: string, enabled: boolean): Promise<void> {
  return call("/api/shopper/sources", { method: "PUT", body: JSON.stringify({ id, enabled }) });
}

/**
 * Checks a want's prices once the server can see it. A want added offline or
 * a moment ago may not have synced yet, so a "Not found" retries a few times
 * before giving up quietly; the daily check picks it up either way.
 */
export async function lookupWhenSynced(wantId: string, tries = 4): Promise<ShopperLookupResult | null> {
  for (let i = 0; i < tries; i++) {
    try {
      return await lookupWant(wantId);
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "Not found" || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

// HOUP-435: Scout. Starting a run answers at once; the research carries on
// on the server and lands in the synced run and pick tables.

export async function startScout(id: string, brief: ScoutBrief): Promise<ShopperSearch> {
  return (await call<{ search: ShopperSearch }>("/api/shopper/scout", { method: "POST", body: JSON.stringify({ id, ...brief }) })).search;
}

export function scoutRun(id: string): Promise<{ search: ShopperSearch | null; picks: ShopperPick[] }> {
  return call(`/api/shopper/scout/${encodeURIComponent(id)}`);
}

/** Puts a pick on the watchlist and checks its prices; answers with the new item. */
export async function watchScoutPick(pickId: string): Promise<ShopperWant> {
  return (await call<{ want: ShopperWant }>(`/api/shopper/scout/picks/${encodeURIComponent(pickId)}`, { method: "POST", body: JSON.stringify({ action: "watch" }) })).want;
}
