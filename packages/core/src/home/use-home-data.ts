'use client';

// The section stores Home reads, shared by both apps' Home screens: tasks,
// events, viewings and listings, costs, setup, groceries, the Shopper watch
// list and the dated checklists, plus what Home derives from them. A
// switched-off module's store opens with no group id (store-modules.ts), so
// Home neither syncs nor shows it. Each app keeps its own writes: the
// stores come back for its useStoreHelpers calls.

import { useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import type {
  Apartment,
  ApartmentWithScore,
  Appointment,
  Checklist,
  ChecklistItem,
  ChecklistResponse,
  ChecklistTaskItem,
  CostItem,
  GroceryItem,
  GroupEvent,
  HouseholdTask,
  SetupItem,
} from '../types';
import { useReconnectSync } from '../data/create-group-store';
import {
  apartmentChecklistItems$,
  apartmentChecklistResponses$,
  apartments$,
  appointments$,
  checklistItems$,
  checklists$,
  costItems$,
  groceryItems$,
  groupEvents$,
  householdTasks$,
  setupItems$,
  shopperPriceSnapshots$,
  shopperWants$,
} from '../data/stores';
import { syncedGroupId } from '../store-modules';
import { todayISO } from '../date-utils';
import { calculateScore } from '../modules/search/scoring';
import { completion, completionLabel } from '../modules/checklists/checklists';
import { countNeeded } from '../modules/groceries/groceries';
import {
  shopperShortcutValue,
  summarizeWants,
  type ShopperPriceSnapshot,
  type ShopperWant,
} from '../modules/shopper/shopper';

/**
 * The store's rows that are really there. A local cache can briefly hold a
 * value that is not a whole row (a Symbol(delete) left by a sync, or a partial
 * object with no id), and Home drew each one as a blank, untitled to-do.
 */
export function liveRows<T extends { deleted: boolean }>(record: Record<string, T | undefined> | undefined): T[] {
  return Object.values(record ?? {}).filter(
    (r): r is T => typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string' && !r.deleted,
  );
}

/** Each listing with its checklist score, or null before anyone answered its checklist. */
export function scoreApartments(
  apartments: Apartment[],
  checklistItems: ChecklistItem[],
  responses: ChecklistResponse[]
): ApartmentWithScore[] {
  const responsesByApartment = new Map<string, Record<string, boolean | null>>();
  for (const r of responses) {
    if (!responsesByApartment.has(r.apartment_id)) responsesByApartment.set(r.apartment_id, {});
    responsesByApartment.get(r.apartment_id)![r.checklist_item_id] = r.value;
  }
  return apartments.map((apt) => {
    const resp = responsesByApartment.get(apt.id) ?? {};
    const hasResponses = Object.keys(resp).length > 0;
    return { ...apt, score: hasResponses ? calculateScore(checklistItems, resp) : null };
  });
}

export interface TaskChecklistLink {
  href: string;
  completionLabel: string;
  completion: { done: number; total: number };
}

/** A dated checklist's lookups: by id, its items in order, and its link by the task it belongs to. */
export function homeChecklistMaps(checklists: Checklist[], items: ChecklistTaskItem[]) {
  const checklistsById: Record<string, Checklist> = {};
  for (const cl of checklists) checklistsById[cl.id] = cl;

  const checklistItemsByChecklistId: Record<string, ChecklistTaskItem[]> = {};
  for (const item of items) (checklistItemsByChecklistId[item.checklist_id] ??= []).push(item);
  for (const list of Object.values(checklistItemsByChecklistId)) list.sort((a, b) => a.order - b.order);

  const checklistByTaskId: Record<string, TaskChecklistLink> = {};
  for (const cl of checklists) {
    if (!cl.linked_task_id) continue;
    const its = items.filter((i) => i.checklist_id === cl.id);
    const { done, total } = completion(its);
    checklistByTaskId[cl.linked_task_id] = { href: `/checklists/${cl.id}`, completionLabel: completionLabel(its), completion: { done, total } };
  }
  return { checklistsById, checklistItemsByChecklistId, checklistByTaskId };
}

/** The Setup shortcut's figure: installed items out of all of them. */
export function homeSetupProgress(items: SetupItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.status === 'installed').length, total: items.length };
}

export function useHomeData(groupId: string | null | undefined, enabledModules: ReadonlySet<string>) {
  const synced = (store$: { collection: string }) => syncedGroupId(store$, groupId, enabledModules);

  const tasks$ = householdTasks$(synced(householdTasks$));
  const events$ = groupEvents$(synced(groupEvents$));
  const appointmentsStore$ = appointments$(synced(appointments$));
  const apartmentsStore$ = apartments$(synced(apartments$));
  const searchChecklistItems$ = apartmentChecklistItems$(synced(apartmentChecklistItems$));
  const searchResponses$ = apartmentChecklistResponses$(synced(apartmentChecklistResponses$));
  const costs$ = costItems$(synced(costItems$));
  const setup$ = setupItems$(synced(setupItems$));
  const groceries$ = groceryItems$(synced(groceryItems$));
  const wants$ = shopperWants$(synced(shopperWants$));
  const snaps$ = shopperPriceSnapshots$(synced(shopperPriceSnapshots$));
  const checklistsStore$ = checklists$(synced(checklists$));
  const checklistItemsStore$ = checklistItems$(synced(checklistItems$));
  useReconnectSync(tasks$);
  useReconnectSync(events$);
  useReconnectSync(appointmentsStore$);
  useReconnectSync(apartmentsStore$);
  useReconnectSync(searchChecklistItems$);
  useReconnectSync(searchResponses$);
  useReconnectSync(costs$);
  useReconnectSync(setup$);
  useReconnectSync(groceries$);
  useReconnectSync(wants$);
  useReconnectSync(snaps$);
  useReconnectSync(checklistsStore$);
  useReconnectSync(checklistItemsStore$);

  const tasks = use$(() => liveRows<HouseholdTask>(tasks$.get()));
  const events = use$(() => liveRows<GroupEvent>(events$.get()));
  const appointments = use$(() => liveRows<Appointment>(appointmentsStore$.get()));
  const apartments = use$(() => liveRows<Apartment>(apartmentsStore$.get()));
  const searchChecklistItems = use$(() => liveRows<ChecklistItem>(searchChecklistItems$.get()));
  const searchResponses = use$(() => liveRows<ChecklistResponse>(searchResponses$.get()));
  const costItems = use$(() => liveRows<CostItem>(costs$.get()));
  const setupItems = use$(() => liveRows<SetupItem>(setup$.get()));
  const groceries = use$(() => liveRows<GroceryItem>(groceries$.get()));
  const shopperWantsList = use$(() => liveRows<ShopperWant>(wants$.get()).filter((w) => w.status === 'watching'));
  const shopperSnapsList = use$(() => liveRows<ShopperPriceSnapshot>(snaps$.get()));
  const checklists = use$(() => liveRows<Checklist>(checklistsStore$.get()));
  const checklistTaskItems = use$(() => liveRows<ChecklistTaskItem>(checklistItemsStore$.get()));

  const apartmentsWithScore = useMemo(
    () => scoreApartments(apartments, searchChecklistItems, searchResponses),
    [apartments, searchChecklistItems, searchResponses]
  );
  const checklistMaps = useMemo(() => homeChecklistMaps(checklists, checklistTaskItems), [checklists, checklistTaskItems]);
  const shopperShortcut = useMemo(
    () => shopperShortcutValue(summarizeWants(shopperWantsList, shopperSnapsList, todayISO())),
    [shopperWantsList, shopperSnapsList]
  );
  const setup = useMemo(() => homeSetupProgress(setupItems), [setupItems]);

  return {
    stores: { tasks$, costs$ },
    tasks,
    events,
    appointments,
    apartments,
    apartmentsWithScore,
    costItems,
    setupItems,
    setup,
    groceries,
    groceryToBuyCount: countNeeded(groceries),
    shopperShortcut,
    ...checklistMaps,
  };
}
