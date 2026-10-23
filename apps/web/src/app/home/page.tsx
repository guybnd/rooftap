'use client';

// ── FLUX-155: the /home hub — a cross-section "what needs me right now" overview ──
// The page owns the household-tasks store + the task edit modal (so hero rows can
// toggle / snooze / long-press-edit / quick-add through one set of writes), derives
// the converged hero items (shared by the hero and the urgent banner), and lays out
// the bento grid. Each section tile owns its own store. hiddenSections removes a
// section's tile, its hero items, and its hero filter tab.
// FLUX-152: global fuzzy search from the hub — one search box finds items across all
// sections; clicking a result opens its full edit modal directly on this page; the
// "add as…" affordance opens the relevant create modal pre-filled with the query.
// Hearth v2 (Pulse + Feed): SummaryHero leads with the Hero count and the Now
// card, TodayHero is the feed, the tiles below are Spaces, and finishing the
// day's last item shows the All clear moment once a day.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { useDataCache } from '@/lib/data-cache';
import { cn } from '@/lib/utils';
import { toastItemAdded } from '@/lib/added-toast';
import { toastUndoDelete } from '@/lib/undo-toast';
import { useTaskSnoozeUndo } from '@/app/tasks/use-task-snooze-undo';
import { useSectionSettings } from '@/lib/use-section';
import { calculateScore, syncedGroupId, householdTasks$, groceryItems$, costItems$, setupItems$, checklists$, checklistItems$, appointments$, apartments$, groupEvents$, apartmentChecklistItems$, apartmentChecklistResponses$, useReconnectSync, useStoreHelpers, useEventSave, createUndoBatchTracker } from '@homeup/core';
import type {
  HouseholdTask,
  GroceryItem,
  CostItem,
  SetupItem,
  Checklist,
  ChecklistTaskItem,
  GoogleCalendarEventWithAttribution,
  Appointment,
  GroupEvent,
  Apartment,
  ApartmentWithScore,
  ChecklistItem,
  ChecklistResponse,
} from '@homeup/core';
import { useBins } from '@homeup/core';
import { upcomingWindowDays, completion, completionLabel, hasVisibleReminders, hiddenWithDisabledModules, useModules, type TaskSnooze } from '@homeup/core';
import { ALL_CLEAR_MOMENT_STORAGE_KEY, HOME_LENS_META, earnedAllClear, heroItemOpenTarget, type HomeLensKey } from '@homeup/core';
import { shopperWants$, shopperPriceSnapshots$, shopperShortcutValue, summarizeWants, type ShopperWant, type ShopperPriceSnapshot } from '@homeup/core';
import { setGlowOverride } from '@/lib/glow-override';
import { toastUndoAction } from '@/lib/undo-toast';
import { EventModal } from '@/app/calendar/event-modal';
import { Moment } from '@/components/ui/moment';
import { HouseholdTaskModal } from '@/app/tasks/household-task-modal';
import { todayISO, addDaysISO, nextOccurrenceISO } from '@/app/tasks/moving-tasks';
import { HOUSEHOLD_TASKS_CHANGED_EVENT } from '@/hooks/use-overdue-task-count';
import { buildHeroItems, heroRangeWindow, parseLocalISODate, type HeroItem, type HeroRange } from './hub-shared';
import { TodayHero, type AddOnDayKind } from './today-hero';
import { CostModal } from '@/app/costs/cost-modal';
import { SummaryHero } from './summary-hero';
import { useWeather } from './use-weather';
import { useWideLayout } from '@/lib/desktop-layout';
import { BudgetSpace, BillsSpace } from './money-spaces';
import { isModuleShown } from './hero-modules';
import { GroceriesWidget } from './groceries-widget';
import { TonightMeal } from './tonight-meal';
import { SetupTile, HomeSearchTile, ShopperTile, AssistantTile } from './section-tiles';
import { DeskHome } from './desk-home';
import { UpOverviewProvider } from '@homeup/core';
import { upBankApi } from '@/lib/up-bank-client';

// The bank overview wraps Home so the Budget figures follow real payments and
// the Budget space can show the latest ones. Opening Home reads Up once.
export default function HomeHubPage() {
  const modules = useModules();
  return (
    <UpOverviewProvider api={upBankApi} enabled={modules.server('connectors.up-bank')} linking={modules.server('connectors.up-bank-links')} sharing={modules.server('connectors.up-bank-sharing')}>
      <HomeHub />
    </UpOverviewProvider>
  );
}

function HomeHub() {
  const { group, memberProfiles, groupMembers, currentUserId, userSettings, loading: cacheLoading } =
    useDataCache();
  const { settings } = useSectionSettings();
  const router = useRouter();
  const modules = useModules();
  // Modules (store-modules.ts): a switched-off module's stores open with no
  // group id, so the hub neither syncs nor shows them.
  const syncedGroup = (store$: { collection: string }) => syncedGroupId(store$, group?.id, modules.enabled);

  // FLUX-150 slice 8: apartments/appointments now come from their own Legend
  // stores rather than useDataCache(); the apartment score (needed to pick the
  // hub tile's "top listing") is recomputed from the checklist stores the same
  // way homesearch/page.tsx does.
  const appointmentsStore$ = appointments$(syncedGroup(appointments$));
  const apartmentsStore$ = apartments$(syncedGroup(apartments$));
  const homeSearchChecklistItemsStore$ = apartmentChecklistItems$(syncedGroup(apartmentChecklistItems$));
  const homeSearchChecklistResponsesStore$ = apartmentChecklistResponses$(syncedGroup(apartmentChecklistResponses$));
  useReconnectSync(appointmentsStore$);
  const eventsStore$ = groupEvents$(syncedGroup(groupEvents$));
  useReconnectSync(eventsStore$);
  const groupEvents = use$(() =>
    Object.values(eventsStore$.get() ?? {}).filter((e): e is GroupEvent => !!e && !e.deleted)
  );
  useReconnectSync(apartmentsStore$);
  useReconnectSync(homeSearchChecklistItemsStore$);
  useReconnectSync(homeSearchChecklistResponsesStore$);
  const appointments = use$(() =>
    Object.values(appointmentsStore$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted)
  );
  const rawApartments = use$(() =>
    Object.values(apartmentsStore$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const homeSearchChecklistItems = use$(() =>
    Object.values(homeSearchChecklistItemsStore$.get() ?? {}).filter((i): i is ChecklistItem => !!i && !i.deleted)
  );
  const homeSearchResponses = use$(() =>
    Object.values(homeSearchChecklistResponsesStore$.get() ?? {}).filter((r): r is ChecklistResponse => !!r && !r.deleted)
  );
  const apartments = useMemo<ApartmentWithScore[]>(() => {
    const responsesByApartment = new Map<string, Record<string, boolean | null>>();
    for (const r of homeSearchResponses) {
      if (!responsesByApartment.has(r.apartment_id)) responsesByApartment.set(r.apartment_id, {});
      responsesByApartment.get(r.apartment_id)![r.checklist_item_id] = r.value;
    }
    return rawApartments.map((apt) => {
      const resp = responsesByApartment.get(apt.id) ?? {};
      const hasResponses = Object.keys(resp).length > 0;
      return {
        ...apt,
        score: hasResponses ? calculateScore(homeSearchChecklistItems, resp) : null,
      };
    });
  }, [rawApartments, homeSearchChecklistItems, homeSearchResponses]);

  // ── Tasks store (already on home for hero) ────────────────────────────────
  const tasks$ = householdTasks$(syncedGroup(householdTasks$));
  useReconnectSync(tasks$);
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: softDeleteTask } = useStoreHelpers(tasks$, currentUserId);
  const snoozeWithUndo = useTaskSnoozeUndo(patchTask);

  const tasks = use$(() =>
    Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted)
  );

  // HOUP-245: delete-undo pill for the hero task list. No tick-off "linger"
  // tracker needed here — buildHeroItems (packages/core/src/hero.ts) already
  // keeps a task completed today visible (sunk to the bottom) rather than
  // hiding it immediately, so there's no hide-on-complete filter to delay.
  const undoBatchTracker = useMemo(() => createUndoBatchTracker<HouseholdTask>(() => {}), []);

  // ── Groceries store ───────────────────────────────────────────────────────
  const groceries$ = groceryItems$(syncedGroup(groceryItems$));
  useReconnectSync(groceries$);

  const groceryList = use$(() =>
    Object.values(groceries$.get() ?? {}).filter((g): g is GroceryItem => !!g && !g.deleted)
  );
  // FLUX-255: summary-hero shoppingList module reads the live "needed" count.
  const groceryToBuyCount = groceryList.filter((g) => g.status === 'needed').length;

  // ── Shopper stores (HOUP-434): the Shopper shortcut's figure ─────────────
  const shopperWantsStore$ = shopperWants$(syncedGroup(shopperWants$));
  const shopperSnapsStore$ = shopperPriceSnapshots$(syncedGroup(shopperPriceSnapshots$));
  useReconnectSync(shopperWantsStore$);
  useReconnectSync(shopperSnapsStore$);
  const shopperWantsList = use$(() =>
    Object.values(shopperWantsStore$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted && w.status === 'watching')
  );
  const shopperSnapsList = use$(() =>
    Object.values(shopperSnapsStore$.get() ?? {}).filter((x): x is ShopperPriceSnapshot => !!x && !x.deleted)
  );
  const shopperShortcut = useMemo(
    () => shopperShortcutValue(summarizeWants(shopperWantsList, shopperSnapsList, todayISO())),
    [shopperWantsList, shopperSnapsList]
  );

  // ── Costs store ───────────────────────────────────────────────────────────
  const costs$ = costItems$(syncedGroup(costItems$));
  useReconnectSync(costs$);
  const { writeRow: writeCost } = useStoreHelpers(costs$, currentUserId);

  // FLUX-255: summary-hero budgetPulse/billsDue modules read the live cost items.
  const costItemsList = use$(() =>
    Object.values(costs$.get() ?? {}).filter((c): c is CostItem => !!c && !c.deleted)
  );

  // ── Setup store ───────────────────────────────────────────────────────────
  const setup$ = setupItems$(syncedGroup(setupItems$));
  useReconnectSync(setup$);

  // FLUX-255: summary-hero setupProgress module reads the live done/total counts.
  const setupSummary = use$(() => {
    const items = Object.values(setup$.get() ?? {}).filter((i): i is SetupItem => !!i && !i.deleted);
    return { done: items.filter((i) => i.status === 'installed').length, total: items.length };
  });

  // ── Checklists stores (FLUX-156: dated checklists surface as dashboard to-dos) ──
  const checklistsStore$ = checklists$(syncedGroup(checklists$));
  const checklistItemsStore$ = checklistItems$(syncedGroup(checklistItems$));
  useReconnectSync(checklistsStore$);
  useReconnectSync(checklistItemsStore$);

  const checklists = use$(() =>
    Object.values(checklistsStore$.get() ?? {}).filter((c): c is Checklist => !!c && !c.deleted)
  );
  const checklistTaskItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((i): i is ChecklistTaskItem => !!i && !i.deleted)
  );

  // FLUX-1565: checklist id → checklist / items, for HeroTaskRow's inline
  // expand panel (mirrors src/app/tasks/page.tsx:72-85).
  const checklistsById = useMemo(() => {
    const map: Record<string, Checklist> = {};
    for (const cl of checklists) map[cl.id] = cl;
    return map;
  }, [checklists]);

  const checklistItemsByChecklistId = useMemo(() => {
    const map: Record<string, ChecklistTaskItem[]> = {};
    for (const item of checklistTaskItems) {
      (map[item.checklist_id] ??= []).push(item);
    }
    for (const list of Object.values(map)) list.sort((a, b) => a.order - b.order);
    return map;
  }, [checklistTaskItems]);

  // task-id → { href, completionLabel } for dated checklists (drives the hero
  // shortcut + live completion). Keyed by the checklist's linked_task_id.
  const checklistByTaskId = useMemo(() => {
    const map: Record<string, { href: string; completionLabel: string; completion: { done: number; total: number } }> = {};
    for (const cl of checklists) {
      if (!cl.linked_task_id) continue;
      const its = checklistTaskItems.filter((i) => i.checklist_id === cl.id);
      const { done, total } = completion(its);
      map[cl.linked_task_id] = {
        href: `/checklists/${cl.id}`,
        completionLabel: completionLabel(its),
        completion: { done, total },
      };
    }
    return map;
  }, [checklists, checklistTaskItems]);

  // ── Section visibility ────────────────────────────────────────────────────
  // A switched-off module counts as hidden for everyone (.docs/modules.md).
  const hidden = hiddenWithDisabledModules(settings.hiddenSections, modules.enabled);
  const isHidden = (id: string) => hidden.includes(id);
  // Modules: agenda tasks, quick add and the Tasks link need household (module-features.ts).
  const householdVisible = !isHidden('household') && modules.feature('hub.tasks');
  const searchVisible = !isHidden('search');
  // Modules: viewings in the agenda need search (module-features.ts).
  const viewingsVisible = searchVisible && modules.feature('hub.viewings');
  // Modules: pulled Google Calendar events need Calendar and Google Calendar (module-features.ts).
  const calendarEventsVisible = modules.feature('hub.calendar-events');
  // Modules: the household's own events need calendar (module-features.ts).
  const eventsVisible = !isHidden('calendar') && modules.feature('hub.events');
  // Modules: a task's checklist link, meter and panel need household and checklists (module-features.ts).
  const taskChecklistsVisible = modules.feature('hub.task-checklists');
  // Modules: bill and document reminders show with Costs and Documents, whether
  // or not Tasks is (task-modules.ts).
  const costsVisible = !isHidden('costs');
  // Each person picks which Spaces Home shows (Customize your summary > Spaces).
  const spaceOn = (key: string) => isModuleShown(key, userSettings?.home_hero_modules, modules.feature);
  const documentsVisible = !isHidden('documents');
  // Home care reminders show with Home Setup and the home-care module on.
  const careVisible = !isHidden('setup') && modules.isEnabled('home-care');
  // Modules: bin night's card needs the Bin night module (module-features.ts).
  const binsVisible = !isHidden('bins') && modules.feature('hub.bins');
  const bins = useBins(binsVisible ? group?.id : undefined, currentUserId);
  const binExtraItems = useMemo(() => (binsVisible && bins.heroItem ? [bins.heroItem] : []), [binsVisible, bins.heroItem]);

  // ── FLUX-236: Today hero range picker (Today / This Week / This Month / Upcoming) ───────
  // Session-only, resets to Upcoming (the user's look-ahead window) on a fresh
  // visit (not persisted).
  const [heroRange, setHeroRange] = useState<HeroRange>('upcoming');
  // Hearth v2: the Space a shortcut has filtered Home down to. While
  // one is open the glow takes its section's hue; leaving Home hands it back.
  const [lens, setLens] = useState<HomeLensKey | null>(null);
  useEffect(() => {
    setGlowOverride(lens ? HOME_LENS_META[lens].sectionId : null);
  }, [lens]);
  useEffect(() => () => setGlowOverride(null), []);
  // The Upcoming range reaches the user's window (Settings, default 90 days).
  const upcomingDays = upcomingWindowDays(userSettings);

  // ── Google Calendar pulled events (FLUX-157) ──────────────────────────────
  // Best-effort: if the user hasn't connected Google, the array just stays empty
  // and the hub tile section is absent — no error UI.
  // FLUX-239: read-through cache, keyed per range (the fetch below is range-scoped,
  // so a single/unkeyed snapshot would bleed one range's events into another).
  const calendarEventsCacheKey = (range: HeroRange) => `homeup:hero-cal-events:v1:${range}`;
  const readCalendarEventsCache = (range: HeroRange): GoogleCalendarEventWithAttribution[] | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(calendarEventsCacheKey(range));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEventWithAttribution[]>(
    () => readCalendarEventsCache('upcoming') ?? []
  );
  // Whether Google Calendar is connected, so the agenda can stay up for pulled
  // events alone. Cached events count until the status call answers.
  const [calendarConnected, setCalendarConnected] = useState(false);
  // Nothing can land in the agenda without tasks, bill or document reminders,
  // viewings or a connected calendar, so it goes too (mobile pulls no Google
  // events, so it checks all but the last).
  const agendaVisible =
    householdVisible ||
    hasVisibleReminders(tasks, { costs: costsVisible, documents: documentsVisible, 'home-care': careVisible }) ||
    viewingsVisible ||
    eventsVisible ||
    (calendarEventsVisible && (calendarConnected || calendarEvents.length > 0));
  useEffect(() => {
    // Modules: no calendar, no fetch (buildHeroItems drops any cached events too).
    if (!calendarEventsVisible) return;
    let cancelled = false;
    // Hydrate the active range's cached snapshot instantly (before the network
    // round trip) so switching ranges / revisiting the hub paints from cache
    // instead of blank — the fetch below revalidates and rewrites it.
    const cached = readCalendarEventsCache(heroRange);
    if (cached) setCalendarEvents(cached);
    (async () => {
      try {
        const statusRes = await fetch('/api/calendar/status');
        if (!statusRes.ok) return;
        const status = await statusRes.json();
        if (!cancelled) setCalendarConnected(!!status.connected);
        if (!status.connected) return;
        // FLUX-236: fetch the selected range's window (±1-day buffer, not a whole
        // past week) — the authoritative range cut happens in buildHeroItems, this
        // window just keeps all-day events safe across timezone boundaries.
        const { from: winFrom, to: winTo } = heroRangeWindow(todayISO(), heroRange, upcomingDays);
        const fromDate = parseLocalISODate(winFrom);
        fromDate.setDate(fromDate.getDate() - 1);
        fromDate.setHours(0, 0, 0, 0);
        const toDate = parseLocalISODate(winTo);
        toDate.setDate(toDate.getDate() + 1);
        toDate.setHours(23, 59, 59, 999);
        const from = fromDate.toISOString();
        const to = toDate.toISOString();
        const eventsRes = await fetch(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (!eventsRes.ok) return;
        const data = await eventsRes.json();
        if (!cancelled) {
          const events = data.events ?? [];
          setCalendarEvents(events);
          try {
            window.localStorage.setItem(calendarEventsCacheKey(heroRange), JSON.stringify(events));
          } catch {
            // best-effort — cache write failure doesn't affect the current render
          }
        }
      } catch {
        // best-effort — leave the array empty on failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [heroRange, upcomingDays, calendarEventsVisible]);

  // FLUX-235: per-device dismiss for calendar hero rows — localStorage, keyed by
  // the stable gcal_event_id (not the DB id, which can churn on re-sync).
  const DISMISSED_CALENDAR_EVENTS_KEY = 'homeup:hero:dismissedCalendarEvents';
  const [dismissedCalendarEventIds, setDismissedCalendarEventIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(DISMISSED_CALENDAR_EVENTS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const dismissCalendarEvent = (item: HeroItem) => {
    const gcalId = item.googleEvent?.gcal_event_id;
    if (!gcalId) return;
    setDismissedCalendarEventIds((prev) => {
      const next = new Set(prev);
      next.add(gcalId);
      try {
        window.localStorage.setItem(DISMISSED_CALENDAR_EVENTS_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort — dismissal still works for this session even if persistence fails
      }
      return next;
    });
  };

  // A household event swiped off Home: per device, like the calendar rows
  // above, and it stays on the calendar. Ids of events that no longer exist
  // drop out whenever the list changes.
  const HIDDEN_EVENTS_KEY = 'homeup:hero:hiddenEvents';
  const [hiddenEventIds, setHiddenEventIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(HIDDEN_EVENTS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const setEventHidden = (eventId: string, hide: boolean) => {
    setHiddenEventIds((prev) => {
      const live = new Set(groupEvents.map((e) => e.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      if (hide) next.add(eventId);
      else next.delete(eventId);
      try {
        window.localStorage.setItem(HIDDEN_EVENTS_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort: the row stays hidden for this session
      }
      return next;
    });
  };
  const hideEvent = (event: GroupEvent) => {
    setEventHidden(event.id, true);
    toastUndoAction('Hidden from Home', () => setEventHidden(event.id, false));
  };
  const homeEvents = useMemo(() => groupEvents.filter((e) => !hiddenEventIds.has(e.id)), [groupEvents, hiddenEventIds]);

  // Holding (or right-clicking) an event's row edits it here, Budget line and all.
  const showEventBudget = modules.feature('calendar.budget');
  const { linkedCostOf, saveEvent, deleteEvent } = useEventSave(eventsVisible ? group?.id : undefined, currentUserId, showEventBudget);
  const [editingEvent, setEditingEvent] = useState<GroupEvent | null>(null);

  const addOnDayKinds: AddOnDayKind[] = [
    ...(householdVisible ? [{ id: 'todo' as const, label: 'To-do' }] : []),
    ...(eventsVisible ? [{ id: 'event' as const, label: 'Calendar event' }] : []),
    ...(!isHidden('checklists') ? [{ id: 'checklist' as const, label: 'Checklist' }] : []),
    ...(costsVisible ? [{ id: 'cost' as const, label: 'Cost' }] : []),
  ];

  // ── Hero items ────────────────────────────────────────────────────────────
  const today = todayISO();
  const showCalendarEventsInTodo = userSettings?.calendar_show_pulled_events_in_todo ?? true;
  // The feed for any range: the current range's list below, and the range
  // menu's counts in TodayHero (calendar events cover the fetched range only).
  const heroItemsFor = useCallback(
    (range: HeroRange) =>
      buildHeroItems({
        tasks,
        appointments,
        apartments,
        today,
        householdVisible,
        searchVisible: viewingsVisible,
        groupEvents: homeEvents,
        groupEventsVisible: eventsVisible,
        viewerId: currentUserId,
        reminderOwnersVisible: { costs: costsVisible, documents: documentsVisible, 'home-care': careVisible },
        calendarEventsVisible,
        taskChecklistsVisible,
        checklistByTaskId,
        calendarEvents,
        showCalendarEventsInTodo,
        dismissedCalendarEventIds,
        range,
        upcomingDays,
        extraItems: binExtraItems,
      }),
    [
      tasks,
      appointments,
      apartments,
      today,
      householdVisible,
      viewingsVisible,
      homeEvents,
      eventsVisible,
      currentUserId,
      costsVisible,
      documentsVisible,
      careVisible,
      calendarEventsVisible,
      taskChecklistsVisible,
      checklistByTaskId,
      calendarEvents,
      showCalendarEventsInTodo,
      dismissedCalendarEventIds,
      upcomingDays,
      binExtraItems,
    ]
  );
  const heroItems = useMemo(() => heroItemsFor(heroRange), [heroItemsFor, heroRange]);

  // FLUX-242/254: today's items for the summary hero — a dedicated range: 'today'
  // call, independent of the range picker's heroItems above, so the "Your day"
  // modules don't change when the picker is flipped to Week/Month.
  const todayHeroItems = useMemo(
    () =>
      buildHeroItems({
        tasks,
        appointments,
        apartments,
        today,
        householdVisible,
        searchVisible: viewingsVisible,
        groupEvents: homeEvents,
        groupEventsVisible: eventsVisible,
        viewerId: currentUserId,
        reminderOwnersVisible: { costs: costsVisible, documents: documentsVisible, 'home-care': careVisible },
        calendarEventsVisible,
        taskChecklistsVisible,
        checklistByTaskId,
        calendarEvents,
        showCalendarEventsInTodo,
        dismissedCalendarEventIds,
        range: 'today',
        extraItems: binExtraItems,
      }),
    [
      tasks,
      appointments,
      apartments,
      today,
      householdVisible,
      viewingsVisible,
      homeEvents,
      eventsVisible,
      currentUserId,
      costsVisible,
      documentsVisible,
      careVisible,
      calendarEventsVisible,
      taskChecklistsVisible,
      checklistByTaskId,
      calendarEvents,
      showCalendarEventsInTodo,
      dismissedCalendarEventIds,
      binExtraItems,
    ]
  );
  const todayCount = useMemo(() => todayHeroItems.filter((i) => !i.done).length, [todayHeroItems]);

  const bumpBadge = () => window.dispatchEvent(new Event(HOUSEHOLD_TASKS_CHANGED_EVENT));

  // ── Hearth v2 moment: finishing today's last open item shows All clear,
  // once a day (core earnedAllClear; the day it last showed stays on device).
  const [allClearOpen, setAllClearOpen] = useState(false);
  const maybeShowAllClear = (finishedId: string) => {
    let lastShown: string | null = null;
    try {
      lastShown = localStorage.getItem(ALL_CLEAR_MOMENT_STORAGE_KEY);
    } catch {
      // Storage blocked: the moment may show again today, which is harmless.
    }
    if (!earnedAllClear(todayHeroItems, finishedId, lastShown, today)) return;
    try {
      localStorage.setItem(ALL_CLEAR_MOMENT_STORAGE_KEY, today);
    } catch {
      // As above.
    }
    setAllClearOpen(true);
  };

  // ── Task actions ──────────────────────────────────────────────────────────
  // Toggle done ↔ undone (FLUX-164: bidirectional so an accidental tap is recoverable).
  const toggleTask = (task: HouseholdTask) => {
    if (task.done) {
      // Un-check: clear done + completed_at; do NOT un-spawn any recurring occurrence.
      patchTask(task.id, { done: false, completed_at: null });
      return;
    }
    maybeShowAllClear(task.id);
    // Mark done: record completion timestamp for linger-until-next-day filtering.
    patchTask(task.id, { done: true, completed_at: new Date().toISOString() });
    if (task.recurrence_days && task.recurrence_days > 0) {
      writeTask({
        id: crypto.randomUUID(),
        group_id: task.group_id,
        title: task.title,
        due_date: nextOccurrenceISO(task.due_date, task.recurrence_days),
        due_time: task.due_time,
        offset_days: null,
        recurrence_days: task.recurrence_days,
        done: false,
        completed_at: null,
        assigned_to: task.assigned_to,
        private: task.private,
        template_key: null,
        notes: task.notes,
        sort_order: task.sort_order,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
    }
    bumpBadge();
  };

  const snoozeTask = (task: HouseholdTask, dur: TaskSnooze) => {
    snoozeWithUndo(task, dur, today);
    bumpBadge();
  };

  // ── Task modal state ──────────────────────────────────────────────────────
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  // The week board's per-day add: a new to-do due on that day.
  const [newTaskDue, setNewTaskDue] = useState<string | undefined>();
  // ...or an event, a dated checklist or a cost on that day, by module.
  const [newEventOn, setNewEventOn] = useState<string | null>(null);
  const [newCostOn, setNewCostOn] = useState<string | null>(null);
  const addOnDay = (kind: AddOnDayKind['id'], dateISO: string) => {
    if (kind === 'todo') {
      setEditingTask(undefined);
      setNewTaskTitle('');
      setNewTaskDue(dateISO);
      setIsTaskModalOpen(true);
    } else if (kind === 'event') setNewEventOn(dateISO);
    else if (kind === 'cost') setNewCostOn(dateISO);
    else router.push(`/checklists/new?date=${dateISO}`);
  };
  const [editingTask, setEditingTask] = useState<HouseholdTask | undefined>();
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // Hearth §13 "Desktop shell": a wide screen gets the summary as a row and
  // the agenda as a week board, with the day forecast over each column.
  const wide = useWideLayout();
  const { data: weather } = useWeather(group?.home_lat ?? null, group?.home_lng ?? null);

  // ── Hero callbacks ────────────────────────────────────────────────────────
  const onHeroToggle = (item: HeroItem) => {
    if (item.task) toggleTask(item.task);
    else if (item.binNight) toggleBinsOut(item);
  };
  // Bin night: finishing its item marks the bins out, and Undo puts it back.
  const toggleBinsOut = (item: HeroItem) => {
    if (!item.binNight) return;
    if (item.done) {
      bins.undoOut();
      return;
    }
    bins.markOut(item.binNight.collectionDate);
    toastUndoAction('Bins out', () => bins.undoOut());
  };
  const onHeroSnooze = (item: HeroItem, dur: TaskSnooze) => {
    if (item.task) snoozeTask(item.task, dur);
  };
  // Hearth v2: the Now card's tap path opens whatever the item is (core
  // heroItemOpenTarget): a dated checklist's to-do opens the checklist itself,
  // a reminder its owner screen, a task its editor, a viewing its listing, a
  // pulled event Google Calendar.
  const onNowOpen = (item: HeroItem) => {
    const target = heroItemOpenTarget(item);
    if (!target) return;
    if (target.kind === 'task') {
      setEditingTask(target.task);
      setNewTaskTitle('');
      setIsTaskModalOpen(true);
      return;
    }
    if (target.kind === 'external') {
      window.open(target.url, '_blank', 'noopener,noreferrer');
      return;
    }
    router.push(target.href);
  };
  // The slide is deliberate, but a slip is still one click from undone.
  const onNowComplete = (item: HeroItem) => {
    if (item.binNight) {
      toggleBinsOut(item);
      return;
    }
    if (!item.task) return;
    const task = item.task;
    toggleTask(task);
    toastUndoAction('Done', () => toggleTask({ ...task, done: true }));
  };
  const onHeroEdit = (item: HeroItem) => {
    if (!item.task) return;
    // Modules: a reminder shown while Tasks isn't opens its bill or document
    // screen, not the task editor (task-modules.ts).
    if (item.opensAt) {
      router.push(item.opensAt);
      return;
    }
    setEditingTask(item.task);
    setNewTaskTitle('');
    setIsTaskModalOpen(true);
  };
  // FLUX-239: persist an inline field edit (due date) from the hero row's hold
  // quick-edit menu, mirroring the /tasks list's own quick-edit menu.
  const onHeroUpdate = (item: HeroItem, patch: Partial<HouseholdTask>) => {
    if (item.task) patchTask(item.task.id, patch);
  };
  // FLUX-245: soft-delete from the hero row's quick-edit menu, matching the
  // Tasks page's handleRequestDelete (no confirm dialog).
  const onHeroDelete = (item: HeroItem) => {
    if (!item.task) return;
    softDeleteTask(item.task.id);
    undoBatchTracker.add(item.task);
    toastUndoDelete(undoBatchTracker.count(), () => {
      undoBatchTracker.restoreAll().forEach((t) => patchTask(t.id, { deleted: false }));
    });
  };

  // ── Guard: loading / no group ─────────────────────────────────────────────
  if (cacheLoading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!group) {
    return <div className="p-6 text-muted-foreground">No group selected</div>;
  }

  // FLUX-190: the top row (tagline + global search) was removed — search now lives
  // in the "+" capture menu, and the top bar already names the section.
  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1680px] lg:px-8 lg:pt-8' : 'max-w-6xl')}>
      {/* Hearth §13.7 "Desktop shell" (Guy, 2026-10-22): on a wide screen
          the narrower Spaces stack in a right-hand sidebar beside the
          summary, the week and Groceries, instead of stretching across the
          full width. A shortcut (lens) still filters Home to one Space. */}
      {wide && !lens ? (
        // Hearth §13.7 (Guy, 2026-10-22): every module, the summary too, sits
        // on a grid you can rearrange and resize (desk-home.tsx).
        <DeskHome
          modules={{
            summary: { label: 'Today', node: (
            <div className="space-y-4">
            <SummaryHero
                lat={group.home_lat ?? null}
                lng={group.home_lng ?? null}
                todayCount={todayCount}
                todayItems={todayHeroItems}
                memberProfiles={memberProfiles}
                currentUserId={currentUserId}
                tasks={tasks}
                budgetCents={userSettings?.costs_budget_monthly ?? null}
                costItems={costItemsList}
                groceryToBuyCount={groceryToBuyCount}
                setup={setupSummary}
                shopperShortcut={shopperShortcut}
                today={today}
                onOpenItem={onNowOpen}
                onCompleteItem={onNowComplete}
                checklistsById={taskChecklistsVisible ? checklistsById : undefined}
                checklistItemsByChecklistId={taskChecklistsVisible ? checklistItemsByChecklistId : undefined}
                lens={lens}
                onLensChange={setLens}
                wide={wide}
              />
              <TonightMeal groupId={group.id} />
            </div>
            ) },
            board: { label: 'Upcoming', node: agendaVisible ? (cols: number) => (
              <TodayHero
                addOnDayKinds={addOnDayKinds}
                onAddOnDay={addOnDay}
                items={heroItems}
                profiles={memberProfiles}
                currentUserId={currentUserId}
                householdVisible={householdVisible}
                searchVisible={viewingsVisible}
                calendarVisible={calendarEventsVisible}
                eventsVisible={eventsVisible}
                today={today}
                range={heroRange}
                onRangeChange={setHeroRange}
                itemsForRange={heroItemsFor}
                onToggle={onHeroToggle}
                onSnooze={onHeroSnooze}
                onEdit={onHeroEdit}
                onUpdate={onHeroUpdate}
                groupMembers={groupMembers}
                onRequestDelete={onHeroDelete}
                onDismissCalendar={dismissCalendarEvent}
                onEditEvent={setEditingEvent}
                onHideEvent={hideEvent}
                checklistsById={taskChecklistsVisible ? checklistsById : undefined}
                checklistItemsByChecklistId={taskChecklistsVisible ? checklistItemsByChecklistId : undefined}
                layout={cols >= 6 ? 'board' : 'feed'}
                windowEnd={heroRangeWindow(today, heroRange, upcomingDays).to}
                weatherDays={weather?.days}
              />
            ) : null },
            // The desk has room for the whole list, not just the essentials (Guy, 2026-10-22).
            groceries: { label: 'Groceries', node: !isHidden('groceries') ? <GroceriesWidget group={group} currentUserId={currentUserId} expanded /> : null },
            budget: { label: 'Budget', node: costsVisible && spaceOn('spaceBudget') ? (
              <BudgetSpace group={group} currentUserId={currentUserId} costItems={costItemsList} budgetCents={userSettings?.costs_budget_monthly ?? null} expanded={false} now={new Date()} />
            ) : null },
            bills: { label: 'Bills', node: costsVisible && spaceOn('spaceBills') ? <BillsSpace costItems={costItemsList} expanded={false} now={new Date()} /> : null },
            setup: { label: 'Home Setup', node: !isHidden('setup') ? <SetupTile group={group} /> : null },
            search: { label: 'Home Search', node: searchVisible ? <HomeSearchTile apartments={apartments} appointments={appointments} /> : null },
            shopper: { label: 'Shopper', node: !isHidden('shopper') ? <ShopperTile group={group} expanded={false} /> : null },
            assistant: { label: 'Assistant', node: !isHidden('assistant') ? <AssistantTile /> : null },
          }}
        />
      ) : (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-3 space-y-4">
          <SummaryHero
            lat={group.home_lat ?? null}
            lng={group.home_lng ?? null}
            todayCount={todayCount}
            todayItems={todayHeroItems}
            memberProfiles={memberProfiles}
            currentUserId={currentUserId}
            tasks={tasks}
            budgetCents={userSettings?.costs_budget_monthly ?? null}
            costItems={costItemsList}
            groceryToBuyCount={groceryToBuyCount}
            setup={setupSummary}
            shopperShortcut={shopperShortcut}
            today={today}
            onOpenItem={onNowOpen}
            onCompleteItem={onNowComplete}
            checklistsById={taskChecklistsVisible ? checklistsById : undefined}
            checklistItemsByChecklistId={taskChecklistsVisible ? checklistItemsByChecklistId : undefined}
            lens={lens}
            onLensChange={setLens}
            wide={wide}
          />
          {!lens && <TonightMeal groupId={group.id} />}
          {!lens && agendaVisible && (
            <TodayHero
              addOnDayKinds={addOnDayKinds}
                onAddOnDay={addOnDay}
              items={heroItems}
              profiles={memberProfiles}
              currentUserId={currentUserId}
              householdVisible={householdVisible}
              searchVisible={viewingsVisible}
              calendarVisible={calendarEventsVisible}
              eventsVisible={eventsVisible}
              today={today}
              range={heroRange}
              onRangeChange={setHeroRange}
              itemsForRange={heroItemsFor}
              onToggle={onHeroToggle}
              onSnooze={onHeroSnooze}
              onEdit={onHeroEdit}
              onUpdate={onHeroUpdate}
              groupMembers={groupMembers}
              onRequestDelete={onHeroDelete}
              onDismissCalendar={dismissCalendarEvent}
              onEditEvent={setEditingEvent}
              onHideEvent={hideEvent}
              checklistsById={taskChecklistsVisible ? checklistsById : undefined}
              checklistItemsByChecklistId={taskChecklistsVisible ? checklistItemsByChecklistId : undefined}
              layout={wide ? 'board' : 'feed'}
              windowEnd={heroRangeWindow(today, heroRange, upcomingDays).to}
              weatherDays={weather?.days}
            />
          )}
        </div>

        {/* Hearth v2: Spaces, the sections' own tiles, under the feed. Home
            is one dashboard: Budget and Bills are always here, and a
            shortcut filters Home down to its own Space, expanded. */}
        {!lens && (
          <h2 className="-mb-1 px-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground lg:col-span-3">
            Spaces
          </h2>
        )}
        {!isHidden('groceries') && (!lens || lens === 'shoppingList') && (
          <GroceriesWidget group={group} currentUserId={currentUserId} expanded={lens === 'shoppingList'} />
        )}
        {costsVisible && (lens === 'budgetPulse' || (!lens && spaceOn('spaceBudget'))) && (
          <BudgetSpace
            group={group}
            currentUserId={currentUserId}
            costItems={costItemsList}
            budgetCents={userSettings?.costs_budget_monthly ?? null}
            expanded={lens === 'budgetPulse'}
            now={new Date()}
          />
        )}
        {costsVisible && (lens === 'billsDue' || (!lens && spaceOn('spaceBills'))) && (
          <BillsSpace costItems={costItemsList} expanded={lens === 'billsDue'} now={new Date()} />
        )}
        {!lens && !isHidden('setup') && <SetupTile group={group} />}
        {!lens && searchVisible && <HomeSearchTile apartments={apartments} appointments={appointments} />}
        {!isHidden('shopper') && (!lens || lens === 'shopperWatch') && (
          <ShopperTile group={group} expanded={lens === 'shopperWatch'} />
        )}
        {!lens && !isHidden('assistant') && <AssistantTile />}
      </div>
      )}

      {/* ── Modals ── */}

      <Moment
        open={allClearOpen}
        onDismiss={() => setAllClearOpen(false)}
        title="All clear"
        caption="Everything on today is done."
      />

      <HouseholdTaskModal
        key={editingTask?.id ?? `new-task-${newTaskTitle}-${newTaskDue ?? ''}`}
        isOpen={isTaskModalOpen}
        task={editingTask}
        groupId={group.id}
        defaultTitle={newTaskTitle || undefined}
        defaultDueDate={newTaskDue}
        onClose={() => {
          setNewTaskDue(undefined);
          setIsTaskModalOpen(false);
          setEditingTask(undefined);
          setNewTaskTitle('');
        }}
        onSave={(task) => {
          const isNew = !editingTask;
          writeTask(task);
          setNewTaskDue(undefined);
          setIsTaskModalOpen(false);
          setEditingTask(undefined);
          setNewTaskTitle('');
          bumpBadge();
          if (isNew) toastItemAdded(task.title, () => { setEditingTask(task); setIsTaskModalOpen(true); });
        }}
        onDelete={(taskId) => {
          softDeleteTask(taskId);
          if (editingTask) {
            undoBatchTracker.add(editingTask);
            toastUndoDelete(undoBatchTracker.count(), () => {
              undoBatchTracker.restoreAll().forEach((t) => patchTask(t.id, { deleted: false }));
            });
          }
          setIsTaskModalOpen(false);
          setEditingTask(undefined);
          setNewTaskTitle('');
          bumpBadge();
        }}
      />

      {newEventOn && group && (
        <EventModal
          isOpen
          groupId={group.id}
          defaultDate={newEventOn}
          showBudget={showEventBudget}
          costCents={null}
          onClose={() => setNewEventOn(null)}
          onSave={(saved, costCents) => {
            saveEvent(saved, costCents);
            setNewEventOn(null);
          }}
        />
      )}

      {newCostOn && group && (
        <CostModal
          key={newCostOn}
          isOpen
          groupId={group.id}
          defaultStartDate={newCostOn}
          onClose={() => setNewCostOn(null)}
          onSave={(item) => {
            writeCost(item);
            setNewCostOn(null);
          }}
        />
      )}

      {editingEvent && group && (
        <EventModal
          isOpen
          event={editingEvent}
          groupId={group.id}
          showBudget={showEventBudget}
          costCents={linkedCostOf(editingEvent)?.amount ?? null}
          onClose={() => setEditingEvent(null)}
          onSave={(saved, costCents) => {
            saveEvent(saved, costCents);
            setEditingEvent(null);
          }}
          onDelete={() => {
            deleteEvent(editingEvent);
            setEditingEvent(null);
          }}
        />
      )}
    </div>
  );
}

