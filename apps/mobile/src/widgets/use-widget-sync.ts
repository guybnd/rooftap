import * as React from 'react';
import { use$ } from '@legendapp/state/react';
import { requestWidgetUpdate } from 'react-native-android-widget';
import {
  apartments$,
  appointments$,
  buildHeroItems,
  buildWidgetGrocerySnapshotItems,
  buildWidgetSnapshotItems,
  conditionForWeatherCode,
  costItems$,
  countNeeded,
  currencySymbol,
  groceryItems$,
  groupEvents$,
  hiddenWithDisabledModules,
  goalTone,
  householdTasks$,
  todayISO,
  upcomingWindowDays,
  useHouseholdCurrency,
  useModules,
  widgetHeroVisibility,
  widgetModuleFlags,
  widgetTodayProgress,
  syncedGroupId,
  type Apartment,
  type Appointment,
  type CostItem,
  type GroceryItem,
  type GroupEvent,
  type HouseholdTask,
  type WidgetSummary,
  upcomingBills,
  useOpeningCostMonth,
  BILLS_DUE_MAX_ROWS,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { readHomeHiddenEventIds } from '@/lib/home-hidden-events';
import { isWeatherStale, readWeatherCache } from './weather-cache';
import { readWidgetSnapshot, writeWidgetSnapshot } from './widget-snapshot';
import { tasksWidgetRepresentation } from './TasksWidget';
import { useAppTheme } from '@/lib/theme-context';

const SYNC_DEBOUNCE_MS = 400;

// HOUP-106/HOUP-110: keeps the widget's snapshot (widget-snapshot.ts) in sync
// with the live householdTasks$/groceryItems$/costItems$ stores while the app
// is foregrounded — the "on-demand" refresh path (mobile-widget-spike.md's
// path 2); updatePeriodMillis in app.config.ts's widget config is the ~30-min
// fallback (path 1). Mount once, high in the tree (src/app/_layout.tsx). See
// widgetTaskHandler.ts for the read/write-back side (the widget's own
// headless task, which never touches this hook).
export function useWidgetSync(): void {
  const { group, currentUserId, userSettings } = useDataCache();
  // The widget draws in the theme picked in the app; a change redraws it.
  const { preference: themePreference } = useAppTheme();
  const groupId = group?.id;
  // Modules: a switched-off module leaves no trace on the widget (.docs/modules.md, section 7),
  // and its stores open with no group id so they don't sync (store-modules.ts).
  const { enabled, feature, server } = useModules();
  // Hearth v2: the feed is Home's Upcoming feed, gated the way Home gates it
  // (modules, and the sections this person hid).
  const hidden = hiddenWithDisabledModules(userSettings?.hidden_sections, enabled);
  const { tasksOn: tasksModuleOn, groceriesOn, costsOn, documentsOn } = widgetModuleFlags(enabled, hidden);
  const tasksOn = tasksModuleOn && feature('hub.tasks');
  const eventsOn = !hidden.includes('calendar') && feature('hub.events');
  const viewingsOn = !hidden.includes('search') && feature('hub.viewings');
  const upcomingDays = upcomingWindowDays(userSettings);
  const tasks$ = householdTasks$(syncedGroupId(householdTasks$, groupId, enabled));
  const groceriesStore$ = groceryItems$(syncedGroupId(groceryItems$, groupId, enabled));
  const costsStore$ = costItems$(syncedGroupId(costItems$, groupId, enabled));
  const events$ = groupEvents$(syncedGroupId(groupEvents$, groupId, enabled));
  const appts$ = appointments$(syncedGroupId(appointments$, groupId, enabled));
  const apts$ = apartments$(syncedGroupId(apartments$, groupId, enabled));

  const tasks = use$(() =>
    Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted),
  );
  const groceries = use$(() =>
    Object.values(groceriesStore$.get() ?? {}).filter((g): g is GroceryItem => !!g && !g.deleted),
  );
  const costItemsList = use$(() =>
    Object.values(costsStore$.get() ?? {}).filter((c): c is CostItem => !!c && !c.deleted),
  );
  const eventsList = use$(() => Object.values(events$.get() ?? {}).filter((e): e is GroupEvent => !!e && !e.deleted));
  const appointmentsList = use$(() =>
    Object.values(appts$.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted),
  );
  const apartmentsList = use$(() => Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted));

  // The budget chip shows what Costs opens on (core costMonth, paid so far),
  // from the bank read Home or Costs made; null until there is one.
  const costMonth = useOpeningCostMonth(costItemsList, server('connectors.up-bank'));

  // Re-sync when the household's currency changes, so the budget chip relabels.
  const currency = useHouseholdCurrency();
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!groupId) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const now = new Date();
      const flags = { tasksOn, groceriesOn, costsOn, documentsOn };
      // Hearth v2: Home's Upcoming feed (its default range and window). Modules:
      // with Tasks off the task rows are only bill and document reminders
      // whose module is on. Events swiped off Home stay off the widget.
      const hiddenEventIds = new Set(readHomeHiddenEventIds());
      const heroItems = buildHeroItems({
        tasks,
        appointments: appointmentsList,
        apartments: apartmentsList,
        today: todayISO(),
        ...widgetHeroVisibility(flags),
        searchVisible: viewingsOn && apartmentsList.length > 0,
        groupEvents: eventsList.filter((e) => !hiddenEventIds.has(e.id)),
        groupEventsVisible: eventsOn,
        viewerId: currentUserId,
        calendarEvents: [],
        range: 'upcoming',
        upcomingDays,
      });
      const items = buildWidgetSnapshotItems(heroItems, currentUserId);
      const progress = widgetTodayProgress(items, todayISO());
      // Modules: no grocery rows or count without Groceries.
      const groceryItems = groceriesOn ? buildWidgetGrocerySnapshotItems(groceries) : [];

      // Modules: no budget or bills without Costs.
      const budgetCents = costsOn ? (userSettings?.costs_budget_monthly ?? null) : null;
      // Not read yet this app session: keep the figure the widget showed, never a total without the bank's payments.
      const kept = costMonth ? null : (readWidgetSnapshot()?.summary?.budget ?? null);
      const spentCents = costMonth ? costMonth.paidCents : (kept?.spentCents ?? null);
      const tone = costMonth ? goalTone(costMonth, budgetCents, now) : (kept?.tone ?? 'success');
      const budget =
        budgetCents != null && spentCents != null
          ? { spentCents, budgetCents, tone: tone === 'neutral' ? 'success' : tone, currencySymbol: currencySymbol() }
          : null;
      const bills = costsOn
        ? upcomingBills(costItemsList, now)
            .slice(0, BILLS_DUE_MAX_ROWS)
            .map((b) => ({
              label: `${b.label}${b.discountEnding ? ' (discount ends)' : ''}`,
              days: b.days,
            }))
        : [];

      const cachedWeather = readWeatherCache();
      const weather = cachedWeather
        ? {
            tempC: cachedWeather.data.tempC,
            condition: conditionForWeatherCode(cachedWeather.data.weatherCode).label,
            iconKey: conditionForWeatherCode(cachedWeather.data.weatherCode).condition,
            updatedAt: cachedWeather.fetchedAt,
            stale: isWeatherStale(cachedWeather.fetchedAt, now),
          }
        : null;

      const summary: WidgetSummary = {
        openTodoCount: progress.left,
        toBuyCount: groceriesOn ? countNeeded(groceries) : 0,
        doneTodayCount: progress.done,
        budget,
        bills,
        weather,
        ...flags,
        upcomingDays,
      };

      writeWidgetSnapshot(items, groceryItems, summary);
      void requestWidgetUpdate({
        widgetName: 'TodaysTasks',
        renderWidget: () => tasksWidgetRepresentation({ items, groceries: groceryItems, summary }, themePreference),
      });
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    groupId,
    currentUserId,
    tasks,
    groceries,
    costItemsList,
    costMonth,
    eventsList,
    appointmentsList,
    apartmentsList,
    userSettings,
    tasksOn,
    groceriesOn,
    costsOn,
    documentsOn,
    eventsOn,
    viewingsOn,
    upcomingDays,
    currency,
    themePreference,
  ]);
}
