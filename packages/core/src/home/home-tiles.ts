'use client';

// What Home's section tiles show, shared by both apps' tiles: Setup's
// progress, the next viewing and best listing, and the Shopper watch list.
// The tiles keep their own rendering and navigation.

import { use$ } from '@legendapp/state/react';
import type { Appointment, ApartmentWithScore, SetupItem } from '../types';
import { useReconnectSync } from '../data/create-group-store';
import { setupItems$, shopperPriceSnapshots$, shopperWants$ } from '../data/stores';
import { todayISO } from '../date-utils';
import { summarize, type SetupSummary } from '../modules/setup/setup';
import {
  isGoodNow,
  sortWatching,
  summarizeWants,
  type ShopperPriceSnapshot,
  type ShopperRowSummary,
  type ShopperWant,
} from '../modules/shopper/shopper';

/** The Setup tile's summary and how many items are done. */
export function useSetupTileSummary(groupId: string): SetupSummary & { done: number } {
  const items$ = setupItems$(groupId);
  useReconnectSync(items$);
  const items = use$(() => Object.values(items$.get() ?? {}).filter((i): i is SetupItem => !!i && !i.deleted));
  const summary = summarize(items);
  return { ...summary, done: summary.total - summary.outstanding };
}

export interface HomeSearchGlance {
  /** The soonest scheduled viewing from now on. */
  nextAppointment: Appointment | null;
  appointmentAt: Date | null;
  /** Its listing's address, or "Viewing" when the listing is gone. */
  appointmentAddress: string | null;
  /** The best-scoring listing still in the search. */
  topListing: ApartmentWithScore | null;
}

export function homeSearchGlance(apartments: ApartmentWithScore[], appointments: Appointment[], nowMs: number): HomeSearchGlance {
  const nextAppointment =
    appointments
      .filter((a) => a.status === 'scheduled' && new Date(a.scheduled_at).getTime() >= nowMs)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] ?? null;
  const topListing =
    [...apartments]
      .filter((a) => !a.archived)
      .sort((a, b) => (b.score?.percentage ?? -1) - (a.score?.percentage ?? -1))[0] ?? null;
  return {
    nextAppointment,
    appointmentAt: nextAppointment ? new Date(nextAppointment.scheduled_at) : null,
    appointmentAddress: nextAppointment
      ? (apartments.find((ap) => ap.id === nextAppointment.apartment_id)?.address ?? 'Viewing')
      : null,
    topListing,
  };
}

export interface ShopperGlance {
  /** Every watched item, good prices first. */
  rows: ShopperRowSummary[];
  good: ShopperRowSummary[];
  /** The best of the good ones. */
  top: ShopperRowSummary | null;
}

export function shopperGlance(wants: readonly ShopperWant[], snaps: readonly ShopperPriceSnapshot[], today: string): ShopperGlance {
  const rows = sortWatching(summarizeWants(wants, snaps, today));
  const good = rows.filter(isGoodNow);
  return { rows, good, top: good[0] ?? null };
}

/** The Shopper tile's watch list, read from the household's stores. */
export function useShopperGlance(groupId: string): ShopperGlance {
  const wants$ = shopperWants$(groupId);
  const snaps$ = shopperPriceSnapshots$(groupId);
  useReconnectSync(wants$);
  useReconnectSync(snaps$);
  const wants = use$(() =>
    Object.values(wants$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted && w.status === 'watching')
  );
  const snaps = use$(() => Object.values(snaps$.get() ?? {}).filter((s): s is ShopperPriceSnapshot => !!s && !s.deleted));
  return shopperGlance(wants, snaps, todayISO());
}
