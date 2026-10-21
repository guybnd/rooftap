// HOUP-434: the web app's calls to /api/shopper. Prices land in the synced
// offer and snapshot stores; these calls only start the work and report how
// it went. Native twin: apps/mobile/src/features/shopper/shopper-api.ts.
import type { SourceDeal } from "@homeup/core";

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
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
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
