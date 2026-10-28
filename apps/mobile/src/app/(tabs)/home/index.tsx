// Hearth v2 (Pulse + Feed): Home leads with a Hero count ("3 of 7 left
// today") on the ground under the coral glow, then the Now card (the next
// thing to do, slide to finish), then the agenda as a feed grouped Earlier /
// Today / Tomorrow with section tiles, then Spaces (the section tiles).
// Finishing the day's last item shows the All clear moment once a day.
//
// HOUP-85: native Home hub — live data + the remaining hero modules HOUP-77
// deferred (weather/tips, all-clear streak, hero customize sheet, the
// expandable groceries widget). The screen's overall shape (hero lede +
// today list + 5-tile grid) is unchanged per the approved plan — only the
// data source and the header/tips/streak block are new.
//
// Store layer (HOUP-73/86) landed since HOUP-77 shipped, so every tile now
// reads its section's real Legend store instead of ./fixtures.ts (removed —
// see the ticket's completion comment). Global fuzzy search stays deferred
// (HOUP-117's own "KNOWN DEFERRAL"); Google Calendar pulled events stay
// deferred to HOUP-100 (native calendar sync, not yet built).
//
// HOUP-208 audit: deliberately NOT migrated to FlashList. This is a dashboard
// hub (hero card + controls + tile grid), not a homogeneous list — its one
// sub-list (the agenda, `visibleHeroItems`) is bounded to a single day/week/
// month view, never unbounded. The mount-time computation audit still
// applies here (see the `buildHeroItems`/`visibleHeroItems`/`heroGrouped`/
// `whosOnHookBuckets` useMemo wrapping below) since this is the first screen
// after cold boot.
import * as React from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter, type Href } from 'expo-router';
import {
  Settings2,
  Flame,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Bell,
  ExternalLink,
  LayoutGrid,
  ShoppingCart,
  ShoppingBag,
  CloudRain,
  CloudSnow,
  Sun,
  Wind,
  Sunset,
  CalendarDays,
  Plus,
  ListChecks,
  ListTodo,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Text,
  haptics,
  Card,
  HeroLede,
  LeadingTile,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Moment,
  NowCardPager,
  PulseTile,
  ScreenBackground,
  TaskChecklistPanel,
  toast,
  ActionMenu,
  type ActionMenuAnchor,
  type NowCardPagerItem,
} from '@homeup/ui';
import {
  HOME_LENS_META,
  filterHeroFeed,
  heroRangeCounts,
  isHeroFeedFiltered,
  openCount,
  type HomeLensKey,
  type HeroTypeFilter,
  buildHeroItems,
  completion,
  computeAllClearStreak,
  countdownDisplay,
  daysUntilLabel,
  formatMoney,
  goalTone,
  useCurrentCostMonth,
  buildDayRibbon,
  skyHeadline,
  MOTION_DURATIONS_MS,
  hiddenWithDisabledModules,
  useModules,
  useHomeAgenda,
  UpOverviewProvider,
  useEventSave,
  useStoreHelpers,
  type TaskSnooze,
  applyTaskCompletion,
  type HeroItem,
  type HeroRange,
  type HouseholdTask,
  type GroupEvent,
  hasVisibleReminders,
  upcomingWindowDays,
  ALL_CLEAR_MOMENT_STORAGE_KEY,
  earnedAllClear,
  feedRowWhen,
  groupFeedItems,
  heroItemOpenTarget,
  heroItemSectionId,
  pickNowQueue,
  nowCardTiming,
  useHomeData,
  todayProgress,
  compareHeroItems,
  heroTips,
  isModuleShown,
  unassignedCount,
  upcomingBills,
  whosOnHookBuckets,
  BILLS_DUE_MAX_ROWS,
  type HeroTipGlyph,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { NoGroupScreen } from '@/components/no-group-screen';
import { createUndoToastPresenter } from '@/lib/undo-toast';
import { useTaskSnoozeUndo } from '@/features/tasks/use-task-snooze-undo';
import { useWeather } from '@/features/home/use-weather';
import { DayRibbon, SkyBlock, SkyNote, useSkyRibbonOpen } from '@/features/home/sky';
import { EventCardFooter } from '@/features/home/event-card-footer';
import { ModuleRowTrailing } from '@/components/module-row-parts';
import { useHeroModuleConfig } from '@/features/home/use-hero-module-config';
import { HeroCustomizeSheet } from '@/features/home/hero-customize-sheet';
import { GroceriesWidget } from '@/features/home/groceries-widget';
import { FeedControls, type FeedTypeOption } from '@/features/home/feed-heading';
import { TonightMeal } from '@/features/home/tonight-meal';
import { BudgetSpace, BillsSpace } from '@/features/home/money-spaces';
import { SetupTile, HomeSearchTile, ShopperTile, AssistantTile } from '@/features/home/section-tiles';
import { formatTime12h, localDateISO } from '@homeup/core';
import { HeroTaskRow } from '@/features/tasks/task-row';
import { HouseholdTaskModal } from '@/features/tasks/household-task-modal';
import { CostModal } from '@/features/costs/cost-modal';
import { upBankApi } from '@/features/costs/up-bank-api';
import { EventModal } from '@/features/calendar/event-modal';
import { EventRowGestures } from '@/features/home/event-row-gestures';
import { useHomeHiddenEvents } from '@/lib/home-hidden-events';
import { randomUUID } from '@/lib/uuid';
import { sectionIconFor } from '@/lib/section-icons';
import { nativeStoreEnvironment } from '@/lib/legend/environment';

// The people line's helpers (whosOnHookBuckets, unassignedCount) and the
// lede's countdown come from core's home/hero-modules.ts, shared with web.
type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  // No names at all yet (the first fetch is still out): not a former member.
  if (!profile) return Object.keys(profiles).length ? 'Former member' : 'Member';
  return profile.name || profile.email || 'Member';
}

function PersonAvatar({ userId, profiles, size = 18 }: { userId: string | null; profiles: MemberProfiles; size?: number }) {
  const avatarUrl = userId ? profiles[userId]?.avatar ?? null : null;
  const label = memberLabel(userId, profiles);
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-muted">
      <Text
        style={{ fontSize: size * 0.5, lineHeight: size * 0.5, includeFontPadding: false, textAlignVertical: 'center' }}
        className="font-medium uppercase text-muted-foreground"
      >
        {label.charAt(0)}
      </Text>
    </View>
  );
}

// Core heroTips picks the lines (first two that qualify); this maps each
// tip's glyph to its lucide-react-native icon.
const TIP_ICON: Record<HeroTipGlyph, LucideIcon> = {
  rain: CloudRain,
  snow: CloudSnow,
  hot: Sun,
  cold: CloudSnow,
  uv: Sun,
  drying: Wind,
  sunset: Sunset,
};

// Hearth v2: the home-group shortcuts show one compact row of at most three (web summary-hero.tsx SHORTCUTS_CAP).
const SHORTCUTS_CAP = 3;

// ── HOUP-150: interactive Today hero (range/type/mine + day grouping) ──────
type TypeFilter = HeroTypeFilter;

// Hearth v2 (Feed): the feed's day header (core groupFeedItems/feedDayLabel)
// — mirrors web's FeedHeader. Earlier is the overdue pile, so it reads in
// the danger hue (status hue as text, H2).
// A day's header also carries a small + (web's FeedHeader twin): it opens
// the add menu for that day, anchored to the button.
function FeedHeader({ groupKey, label, onAdd }: { groupKey: string; label: string; onAdd?: (anchor: ActionMenuAnchor) => void }) {
  const ref = React.useRef<View>(null);
  return (
    <View className="flex-row items-center justify-between px-1 pt-1">
      <Text className={`text-micro-label uppercase ${groupKey === 'earlier' ? 'text-destructive' : 'text-muted-foreground'}`}>{label}</Text>
      {onAdd && (
        <Pressable
          ref={ref}
          accessibilityRole="button"
          accessibilityLabel={`Add to ${label}`}
          hitSlop={12}
          onPress={() => ref.current?.measureInWindow((x, y, width, height) => onAdd({ x, y, width, height }))}
          className="-my-1 h-7 w-7 items-center justify-center rounded-[9px] active:bg-card"
        >
          <Plus size={16} className="text-muted-foreground" />
        </Pressable>
      )}
    </View>
  );
}

/** Where a hub item opens on native: its task editor, a reminder's owner, or a viewing's listing. */
type OpenHeroItem = (item: HeroItem) => void;

// HOUP-172 (item 4): hairline dividers between rows without ListGroup's own
// border/rounding/shadow — the fused controls+list Card already owns the
// single H4 border for this surface, so a nested ListGroup here would read
// as a double border.
function DividedRows({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <>
      {items.map((child, index) => (
        <React.Fragment key={index}>
          {index > 0 && <View className="h-px bg-border" />}
          {child}
        </React.Fragment>
      ))}
    </>
  );
}

const HIDDEN = { display: 'none' } as const;

// The bank overview wraps Home so the Budget figures follow real payments and
// the Budget space can show the latest ones. Opening Home reads Up once.
export default function HomeSectionScreen() {
  const modules = useModules();
  return (
    <UpOverviewProvider api={upBankApi} enabled={modules.server('connectors.up-bank')} linking={modules.server('connectors.up-bank-links')}
      sharing={modules.server('connectors.up-bank-sharing')}
    >
      <HomeSectionBody />
    </UpOverviewProvider>
  );
}

function HomeSectionBody() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { group, currentUserId, groupMembers, memberProfiles, userSettings, loading: cacheLoading } = useDataCache();
  const modules = useModules();

  // ── Live section stores ───────────────────────────────────────────────────
  // Home's section stores and what it derives from them (core useHomeData,
  // shared with web): tasks, events, viewings and scored listings, costs,
  // setup, groceries, the Shopper figure and the dated checklists.
  // GroceriesWidget and ShopperTile still read their own copies for their cards.
  const home = useHomeData(group?.id, modules.enabled);
  const {
    tasks,
    costItems: costItemsList,
    setupItems: setupItemsList,
    groceryToBuyCount,
    shopperShortcut,
    checklistsById,
    checklistItemsByChecklistId,
    checklistByTaskId,
    apartmentsWithScore,
  } = home;
  const tasks$ = home.stores.tasks$;
  const eventsList = home.events;
  // An event swiped off Home stays on the calendar (home-hidden-events.ts).
  const eventIds = React.useMemo(() => eventsList.map((e) => e.id), [eventsList]);
  const { hidden: hiddenEventIds, hide: hideEvent, unhide: unhideEvent } = useHomeHiddenEvents(eventIds);
  const homeEvents = React.useMemo(() => eventsList.filter((e) => !hiddenEventIds.has(e.id)), [eventsList, hiddenEventIds]);
  const appointmentsList = home.appointments;
  const apartmentsList = home.apartments;
  const { writeRow: writeCost } = useStoreHelpers(home.stores.costs$, currentUserId);

  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(tasks$, currentUserId);
  const snoozeWithUndo = useTaskSnoozeUndo(patchRow);

  // HOUP-245: delete-undo pill (no tick-off linger on this screen — the
  // agenda already keeps a task completed today visible until midnight, see
  // buildHeroItems' "keep visible only if completed today" gate in hero.ts,
  // so there's no immediate hide-on-complete for a grace window to cover).
  const patchRowRef = React.useRef(patchRow);
  patchRowRef.current = patchRow;
  const taskDeleteUndo = React.useMemo(
    () =>
      createUndoToastPresenter<HouseholdTask>({
        message: (count) => (count === 1 ? 'Task deleted' : `${count} tasks deleted`),
        restore: (task) => patchRowRef.current(task.id, { deleted: false }),
      }),
    []
  );

  // ── HOUP-150 (was HOUP-65/FLUX-65): hiddenSections contract — one read, one
  // section-id map, applied everywhere a section can appear on the hub. ──────
  // Modules (.docs/modules.md): a switched-off module counts as hidden here.
  const hidden = hiddenWithDisabledModules(userSettings?.hidden_sections, modules.enabled);
  // Modules: agenda tasks and quick add need household (module-features.ts).
  const householdVisible = !hidden.includes('household') && modules.feature('hub.tasks');
  const searchVisible = apartmentsList.length > 0 && !hidden.includes('search');
  // Modules: viewings in the agenda need search (module-features.ts).
  const viewingsVisible = searchVisible && modules.feature('hub.viewings');
  // Modules: a task's checklist link, meter and panel need household and checklists (module-features.ts).
  const taskChecklistsVisible = modules.feature('hub.task-checklists');
  // Modules: bill and document reminders show with Costs and Documents, whether
  // or not Tasks is (task-modules.ts).
  const costsVisible = !hidden.includes('costs');
  const documentsVisible = !hidden.includes('documents');
  // Home care reminders show with Home Setup and the home-care module on.
  const careVisible = !hidden.includes('setup') && modules.isEnabled('home-care');
  // Modules: the household's own events need calendar (module-features.ts).
  const eventsVisible = !hidden.includes('calendar') && modules.feature('hub.events');
  // Holding an event's row edits it here, Budget line and all (use-event-save.ts).
  const { linkedCostOf, saveEvent, deleteEvent } = useEventSave(eventsVisible ? group?.id : undefined, currentUserId, modules.feature('calendar.budget'));
  // Other modules' feed items (bin night): the Home agenda slot, each on its hub feature and section.
  const moduleAgenda = useHomeAgenda(group?.id, currentUserId, hidden);
  const [eventModalOpen, setEventModalOpen] = React.useState(false);
  const [editingEvent, setEditingEvent] = React.useState<GroupEvent | null>(null);
  const unhideEventRef = React.useRef(unhideEvent);
  unhideEventRef.current = unhideEvent;
  const eventHideUndo = React.useMemo(
    () =>
      createUndoToastPresenter<string>({
        message: (count) => (count === 1 ? 'Hidden from Home' : `${count} events hidden from Home`),
        restore: (id) => unhideEventRef.current(id),
      }),
    []
  );
  // 'hub.calendar-events' has nothing to gate here: mobile pulls no Google
  // events yet (HOUP-100), so tasks, bill and document reminders and viewings
  // are the agenda's only sources and with all of them off it goes too.
  const agendaVisible =
    householdVisible ||
    hasVisibleReminders(tasks, { costs: costsVisible, documents: documentsVisible, 'home-care': careVisible }) ||
    viewingsVisible ||
    eventsVisible;

  // HOUP-208 mount-time audit: this is the first screen after cold boot, so
  // its derived-computation cost matters most. `buildHeroItems` (called twice
  // below — once for the today-scoped agenda, once for the range-scoped hero
  // list) and the filter/sort/group chain that follows it used to re-run on
  // every render (every keystroke in quick-add, every range/filter toggle) —
  // wrapped in useMemo so they only recompute when their actual inputs change.
  // `now` stays a plain per-render `new Date()` for the live "current instant"
  // reads below (streak/tips/countdown; never a hook dependency). `todayISOStr`
  // is its own memo (computed once per mount) rather than derived from `now`
  // inline, so it's a stable string dependency the React Compiler can track —
  // deriving it from a fresh, non-memoized Date each render tripped
  // `react-hooks/preserve-manual-memoization` ("this dependency may be mutated
  // later"). Trade-off: "today" is fixed at mount instead of ticking over
  // exactly at midnight if this screen is left open continuously — accepted,
  // since any data change (tasks/appointments) or a re-navigation already
  // remounts/refreshes it.
  const now = new Date();
  const todayISOStr = React.useMemo(() => localDateISO(new Date()), []);

  // ── Weather + tips + streak (HOUP-85) ─────────────────────────────────────
  // Hoisted above the hero-item derivation (was below it on HOUP-208): HOUP-222
  // gates `next` on `heroConfig`, so the config read has to precede it.
  const { config: heroConfig, setModule, countdown, setCountdown, flushCountdown } = useHeroModuleConfig();
  // Modules: budget, bills, groceries, setup and the task-only modules need
  // their module (module-features.ts), whatever the person's config says.
  const heroOn = (key: string) => isModuleShown(key, heroConfig, modules.feature);
  const [customizeOpen, setCustomizeOpen] = React.useState(false);
  const { data: weather, error: weatherError } = useWeather(group?.home_lat ?? null, group?.home_lng ?? null);
  const streak = heroOn('streak') ? computeAllClearStreak(tasks, now) : 0;

  const todayItems = React.useMemo(
    () =>
      buildHeroItems({
        tasks,
        appointments: appointmentsList,
        apartments: apartmentsList,
        today: todayISOStr,
        householdVisible,
        searchVisible: viewingsVisible,
        groupEvents: homeEvents,
        groupEventsVisible: eventsVisible,
        viewerId: currentUserId,
        reminderOwnersVisible: { costs: costsVisible, documents: documentsVisible, 'home-care': careVisible },
        taskChecklistsVisible,
        checklistByTaskId,
        extraItems: moduleAgenda.items,
      }),
    [tasks, appointmentsList, apartmentsList, homeEvents, eventsVisible, currentUserId, todayISOStr, householdVisible, viewingsVisible, costsVisible, documentsVisible, careVisible, taskChecklistsVisible, checklistByTaskId, moduleAgenda.items]
  );

  const todayLabel = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // HOUP-222: web parity (apps/web/src/app/home/summary-hero.tsx) — count/
  // nextUp now gate the whisper/lede instead of always rendering.
  const countEnabled = heroOn('count');
  const nextUpEnabled = heroOn('nextUp');
  // Hearth v2 (Pulse): the Hero lede counts today ("3 of 7 left today",
  // gated on the count module) and the Now card pages through the next few
  // things to do (gated on the nextUp module), both from core feed.ts so web
  // agrees.
  const progress = React.useMemo(() => todayProgress(todayItems), [todayItems]);

  // Hearth v2 (day ribbon): the sky block beside the Hero and its hourly
  // ribbon (features/home/sky.tsx); open/closed is remembered per device.
  const [ribbonOpen, toggleRibbon] = useSkyRibbonOpen();
  const sky = heroOn('weather') ? weather : null;
  const skyLine = sky ? skyHeadline(sky, now).text : '';
  // Weather on but nothing to show: say why instead of leaving the spot empty.
  const skyNote: 'noLocation' | 'unavailable' | null =
    !heroOn('weather') || weather
      ? null
      : group?.home_lat == null || group?.home_lng == null
        ? 'noLocation'
        : weatherError
          ? 'unavailable'
          : null;
  const ribbon = React.useMemo(
    () =>
      sky
        ? buildDayRibbon(
            sky,
            todayItems.filter((i) => i.dueTime && !i.done).map((i) => `${todayISOStr}T${i.dueTime}`),
          )
        : [],
    [sky, todayItems, todayISOStr],
  );
  const nowQueue = React.useMemo(
    () => (nextUpEnabled ? pickNowQueue(todayItems, todayISOStr) : []),
    [nextUpEnabled, todayItems, todayISOStr]
  );

  // Hearth v2 moment: finishing today's last open item shows All clear,
  // once a day (core earnedAllClear; the day it last showed is kept on device).
  const [allClearOpen, setAllClearOpen] = React.useState(false);
  const maybeShowAllClear = (finishedId: string) => {
    let lastShown: string | null = null;
    try {
      lastShown = nativeStoreEnvironment.keyValue.getItem(ALL_CLEAR_MOMENT_STORAGE_KEY);
    } catch {
      // kv-store unavailable: the moment may show again today, which is harmless.
    }
    if (!earnedAllClear(todayItems, finishedId, lastShown, todayISOStr)) return;
    try {
      nativeStoreEnvironment.keyValue.setItem(ALL_CLEAR_MOMENT_STORAGE_KEY, todayISOStr);
    } catch {
      // As above.
    }
    setAllClearOpen(true);
    // The finish already landed pop(); the moment answers with the roll.
    haptics.celebrate();
  };

  // The first two tips that are on and qualify, in registry order (core heroTips).
  const tips = heroTips(weather, now, heroOn).map((tip) => ({ ...tip, Icon: TIP_ICON[tip.glyph] }));

  // ── HOUP-150: interactive Today hero — range/type/mine controls and
  // gesture rows via the native TaskRow. Hearth v2 (heading menu): the
  // range is the feed's title and type/"just me" sit behind one filter
  // button (features/home/feed-heading.tsx); quick add went, the tab bar's
  // + already adds. ─────────────────────────────────────────────────────────
  // Opens on Upcoming (the user's look-ahead window), web parity.
  const [heroRange, setHeroRange] = React.useState<HeroRange>('upcoming');
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>('all');
  const [mineOnly, setMineOnly] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  // Add to a day (the + on a feed day header): a to-do, event, dated
  // checklist or cost, each opened already set to that day.
  const [addOn, setAddOn] = React.useState<{ anchor: ActionMenuAnchor; date: string } | null>(null);
  const [newTaskDue, setNewTaskDue] = React.useState<string | undefined>();
  const [newEventOn, setNewEventOn] = React.useState<string | undefined>();
  const [newCostOn, setNewCostOn] = React.useState<string | null>(null);
  const addOnDayItems = (date: string) => [
    ...(householdVisible
      ? [{ key: 'todo', label: 'To-do', Icon: ListChecks, onPress: () => { setEditingTask(undefined); setNewTaskDue(date); setModalOpen(true); } }]
      : []),
    ...(eventsVisible
      ? [{ key: 'event', label: 'Calendar event', Icon: CalendarDays, onPress: () => { setEditingEvent(null); setNewEventOn(date); setEventModalOpen(true); } }]
      : []),
    ...(!hidden.includes('checklists')
      ? [{ key: 'checklist', label: 'Checklist', Icon: ListTodo, onPress: () => router.push(`/checklists/new?date=${date}` as Href) }]
      : []),
    ...(costsVisible ? [{ key: 'cost', label: 'Cost', Icon: Wallet, onPress: () => setNewCostOn(date) }] : []),
  ];
  const [editingTask, setEditingTask] = React.useState<HouseholdTask | undefined>();
  // Hearth v2: the shortcut Home is filtered to (its Space, expanded; tap again for the dashboard).
  const [lensKey, setLens] = React.useState<HomeLensKey | null>(null);

  // The feed for any range: the current range's list, and the range sheet's counts.
  const heroItemsFor = React.useCallback(
    (range: HeroRange) =>
      buildHeroItems({
        tasks,
        appointments: appointmentsList,
        apartments: apartmentsList,
        today: todayISOStr,
        householdVisible,
        searchVisible: viewingsVisible,
        groupEvents: homeEvents,
        groupEventsVisible: eventsVisible,
        viewerId: currentUserId,
        reminderOwnersVisible: { costs: costsVisible, documents: documentsVisible, 'home-care': careVisible },
        taskChecklistsVisible,
        range,
        // The Upcoming range reaches the user's window (Settings, default 90 days).
        upcomingDays: upcomingWindowDays(userSettings),
        checklistByTaskId,
        extraItems: moduleAgenda.items,
      }),
    [tasks, appointmentsList, apartmentsList, homeEvents, eventsVisible, currentUserId, todayISOStr, householdVisible, viewingsVisible, costsVisible, documentsVisible, careVisible, taskChecklistsVisible, userSettings, checklistByTaskId, moduleAgenda.items]
  );
  const heroItems = React.useMemo(() => heroItemsFor(heroRange), [heroItemsFor, heroRange]);

  // Which type filters show (no Calendar: mobile pulls no Google events yet).
  // Modules: a filter that went away (say Tasks switched off) falls back to
  // All, where bill and document reminders still show.
  const typeTabShown: Record<TypeFilter, boolean> = {
    all: true,
    task: householdVisible,
    reminder: householdVisible,
    appointment: viewingsVisible,
    event: eventsVisible,
    calendar: false,
    // Other modules' items (bin night) show under All only.
    module: false,
  };
  const activeType: TypeFilter = typeTabShown[typeFilter] ? typeFilter : 'all';
  const typeOptions: FeedTypeOption[] = [
    { value: 'all', label: 'All', Icon: LayoutGrid },
    ...(typeTabShown.task
      ? ([
          { value: 'task', label: 'Tasks', Icon: ClipboardList },
          { value: 'reminder', label: 'Reminders', Icon: Bell },
        ] as FeedTypeOption[])
      : []),
    ...(typeTabShown.event ? ([{ value: 'event', label: 'Events', Icon: CalendarDays }] as FeedTypeOption[]) : []),
    ...(typeTabShown.appointment ? ([{ value: 'appointment', label: 'Viewings', Icon: CalendarClock }] as FeedTypeOption[]) : []),
  ];

  const feedFilter = React.useMemo(
    () => ({ type: activeType, mineOnly, userId: currentUserId }),
    [activeType, mineOnly, currentUserId]
  );
  const isHeroToday = heroRange === 'today';
  const visibleHeroItems = React.useMemo(
    () => filterHeroFeed(heroItems, feedFilter).sort((a, b) => compareHeroItems(a, b, isHeroToday)),
    [heroItems, feedFilter, isHeroToday]
  );
  const rangeCounts = React.useMemo(() => heroRangeCounts(heroItemsFor, feedFilter), [heroItemsFor, feedFilter]);

  // HOUP-172: people line (item 3) — today-scoped (independent of the range
  // picker), mirrors web's peopleLine in summary-hero.tsx.
  const { assigneeIds, countFor } = React.useMemo(
    () => whosOnHookBuckets(todayItems, currentUserId, memberProfiles),
    [todayItems, currentUserId, memberProfiles]
  );
  const showWhosOnHook = heroOn('whosOnHook') && assigneeIds.length > 0;
  const unassigned = React.useMemo(() => unassignedCount(todayItems), [todayItems]);
  const showUnassignedChip = heroOn('unassignedNudge') && unassigned > 0;

  const budgetCents = userSettings?.costs_budget_monthly ?? null;
  // The Budget shortcut reads like the Costs hero: paid so far out of the
  // goal, amber while the month is heading over, red once paid passes it
  // (core goalTone), never the month-end forecast as if already spent.
  const costMonth = useCurrentCostMonth(costItemsList);
  const setup = React.useMemo(
    () => ({ done: setupItemsList.filter((s) => s.status === 'installed').length, total: setupItemsList.length }),
    [setupItemsList]
  );

  const showBudgetPulseTile = heroOn('budgetPulse') && budgetCents != null;
  const budgetPulseTone = costMonth ? goalTone(costMonth, budgetCents, now) : 'neutral';

  // HOUP-172: pulse tiles (item 2) — same qualification rules as web's
  // billsDue/shoppingList/setupProgress modules (a module renders nothing,
  // not a zero-state tile, when it has nothing to say).
  const soonestBills = upcomingBills(costItemsList, now).slice(0, BILLS_DUE_MAX_ROWS);
  const nextBill = soonestBills[0] ?? null;
  const showBillsTile = heroOn('billsDue') && !!nextBill;
  const showGroceriesTile = heroOn('shoppingList') && groceryToBuyCount > 0;
  const showShopperTile = heroOn('shopperWatch') && shopperShortcut != null;
  const showSetupTile = heroOn('setupProgress') && setup.total > 0 && setup.done < setup.total;
  const countdownDisplayValue = countdownDisplay(countdown, todayISOStr);
  const showCountdownTile = heroOn('countdown') && countdownDisplayValue !== null;

  // Hearth v2: shortcuts, in registry order, the first SHORTCUTS_CAP that have
  // something to say (an empty one doesn't take a slot).
  const shortcutClass = 'bg-card/70 px-3 py-2';
  type Shortcut = { key: string; node: React.ReactNode };
  // Budget, Bills and Groceries open their lens in place (tap again for
  // Today); setup and countdown keep their plain behaviour.
  const lensTap = (key: HomeLensKey) => ({
    onPress: () => {
      haptics.select();
      setLens((open) => (open === key ? null : key));
    },
    selected: lensKey === key,
  });
  const shortcutCandidates: (Shortcut | null)[] = [
    showBudgetPulseTile && budgetCents != null
      ? {
          key: 'budgetPulse',
          node: (
            <PulseTile
              {...lensTap('budgetPulse')}
              label="Budget"
              tone={budgetPulseTone}
              value={
                // Before the bank's payments are in no figure shows: one without them jumps once they land.
                costMonth ? (
                  <Text numberOfLines={1} className={`text-sm font-semibold tabular-nums ${budgetPulseTone === 'danger' ? 'text-destructive' : 'text-foreground'}`}>
                    {formatMoney(costMonth.paidCents)}
                  </Text>
                ) : (
                  <View className="my-0.5 h-3.5 w-14 rounded bg-muted" />
                )
              }
              meter={{ value: costMonth?.paidCents ?? 0, total: budgetCents }}
              accessibilityLabel={costMonth ? `Budget, ${formatMoney(costMonth.paidCents)} of ${formatMoney(budgetCents)} so far` : 'Budget, reading your bank payments'}
              className={shortcutClass}
            />
          ),
        }
      : null,
    showBillsTile && nextBill
      ? {
          key: 'billsDue',
          node: (
            <PulseTile
              {...lensTap('billsDue')}
              label="Bills"
              value={`${nextBill.discountEnding ? 'Discount ends ' : ''}${daysUntilLabel(nextBill.days)}${soonestBills.length > 1 ? ` · +${soonestBills.length - 1}` : ''}`}
              className={shortcutClass}
            />
          ),
        }
      : null,
    showGroceriesTile
      ? {
          key: 'shoppingList',
          node: (
            <PulseTile
              {...lensTap('shoppingList')}
              label="Groceries"
              Icon={ShoppingCart}
              value={`${groceryToBuyCount} to buy`}
              className={shortcutClass}
            />
          ),
        }
      : null,
    showShopperTile && shopperShortcut
      ? {
          key: 'shopperWatch',
          node: (
            <PulseTile
              {...lensTap('shopperWatch')}
              label="Shopper"
              Icon={ShoppingBag}
              value={shopperShortcut}
              className={shortcutClass}
            />
          ),
        }
      : null,
    showSetupTile
      ? {
          key: 'setupProgress',
          node: (
            <PulseTile
              onPress={() => router.push('/setup')}
              label="Setup"
              value={`${setup.done}/${setup.total}`}
              meter={{ value: setup.done, total: setup.total }}
              className={shortcutClass}
            />
          ),
        }
      : null,
    showCountdownTile && countdownDisplayValue
      ? {
          key: 'countdown',
          node: (
            <PulseTile label="Countdown" value={`${countdownDisplayValue.label} · ${countdownDisplayValue.when}`} className={shortcutClass} />
          ),
        }
      : null,
  ];
  const shortcuts = shortcutCandidates.filter((tile): tile is Shortcut => tile !== null).slice(0, SHORTCUTS_CAP);
  // A lens whose shortcut has gone (the list emptied, the module was
  // switched off) closes, so Home never sits filtered with no way back.
  const lens = lensKey != null && shortcuts.some((t) => t.key === lensKey) ? lensKey : null;
  // The tap rings its shortcut at once; swapping the dashboard for the
  // expanded Space (a long grocery list can be dozens of rows) renders as a
  // deferred pass so the tap never waits on it.
  const shownLens = React.useDeferredValue(lens);
  // Filtering hides the rest of the dashboard rather than unmounting it, so
  // turning the filter off doesn't rebuild the feed and every Space.
  const showIf = (on: boolean) => (on ? undefined : HIDDEN);

  const handleToggleComplete = (task: HouseholdTask) => {
    const { update, createNextOccurrence } = applyTaskCompletion(task, !task.done, { nextId: randomUUID() });
    patchRow(task.id, update);
    if (createNextOccurrence) writeRow(createNextOccurrence);
    if (!task.done) maybeShowAllClear(task.id);
  };

  // The slide is deliberate, but a slip is still one tap from undone: the
  // toast un-ticks it (a spawned next occurrence stays, as a row undo does).
  const finishFromNowCard = (task: HouseholdTask) => {
    handleToggleComplete(task);
    toast.message('Done', {
      duration: 4000,
      action: { label: 'Undo', onPress: () => handleToggleComplete({ ...task, done: true }) },
    });
  };

  // Another module's item (bin night): finishing it goes through its source, and Undo takes it back.
  const finishModuleItem = (item: HeroItem) => {
    if (item.done || !moduleAgenda.canComplete(item)) return;
    moduleAgenda.complete(item);
    toast.message(item.module?.doneLabel ?? 'Done', {
      duration: 4000,
      action: { label: 'Undo', onPress: () => moduleAgenda.undo(item) },
    });
  };

  const openHeroItem: OpenHeroItem = (item) => {
    if (item.task) {
      // Modules: a reminder shown while Tasks isn't opens its bill or
      // document screen, not the task editor (task-modules.ts).
      if (item.opensAt) {
        openRoute(item.opensAt);
        return;
      }
      setEditingTask(item.task);
      setModalOpen(true);
      return;
    }
    if (item.appointment) {
      router.push(`/apartment/${item.appointment.apartment_id}` as Href);
      return;
    }
    // Anything else with a screen of its own (another module's item opens its screen).
    const target = heroItemOpenTarget(item);
    if (target?.kind === 'route') openRoute(target.href);
  };

  // The Now card's tap path opens whatever the item is (core
  // heroItemOpenTarget): a dated checklist's to-do opens the checklist itself,
  // a reminder its owner screen, a task its editor, a viewing its listing.
  const openNowItem = (item: HeroItem) => {
    const target = heroItemOpenTarget(item);
    if (!target) return;
    if (target.kind === 'task') {
      setEditingTask(target.task);
      setModalOpen(true);
      return;
    }
    if (target.kind === 'external') {
      Linking.openURL(target.url);
      return;
    }
    openRoute(target.href);
  };

  const handleSnooze = (task: HouseholdTask, dur: TaskSnooze) => {
    snoozeWithUndo(task, dur);
  };

  const handleReassign = (task: HouseholdTask, userId: string | null) => {
    patchRow(task.id, { assigned_to: userId });
  };

  const handlePriorityChange = (task: HouseholdTask, priority: HouseholdTask['priority']) => {
    patchRow(task.id, { priority });
  };

  const handleRecurrenceChange = (task: HouseholdTask, days: number | null) => {
    patchRow(task.id, { recurrence_days: days });
  };

  const handleFieldChange = (task: HouseholdTask, field: 'title' | 'due_date' | 'notes', value: string) => {
    const payload: Partial<HouseholdTask> = {};
    if (field === 'title') {
      if (!value.trim()) return;
      payload.title = value.trim();
    } else if (field === 'due_date') {
      payload.due_date = value || null;
      if (task.template_key && task.offset_days != null) {
        payload.template_key = null;
        payload.offset_days = null;
      }
    } else if (field === 'notes') {
      payload.notes = value.trim() || null;
    }
    patchRow(task.id, payload);
  };

  const renderHeroRow = (item: HeroItem) => {
    if (item.task) {
      return (
        <HeroTaskRow
          key={item.id}
          item={item}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          currentUserId={currentUserId}
          onToggleComplete={handleToggleComplete}
          onEdit={() => openHeroItem(item)}
          onDelete={(t) => { softDeleteRow(t.id); taskDeleteUndo.addAndShow(t); }}
          onSnooze={handleSnooze}
          onReassign={handleReassign}
          onPriorityChange={handlePriorityChange}
          onRecurrenceChange={handleRecurrenceChange}
          onFieldChange={handleFieldChange}
          checklistsById={taskChecklistsVisible ? checklistsById : undefined}
          checklistItemsByChecklistId={taskChecklistsVisible ? checklistItemsByChecklistId : undefined}
        />
      );
    }
    // Inert appointment row (no data source is 'calendar' yet — HOUP-164
    // brings pulled Google Calendar events into this same merge) — mirrors
    // web's HeroRow fallback (today-hero.tsx:487-531): tap/swipe/hold are all
    // no-ops for appointments; the trailing assignee avatar, "Open ›"
    // checklist link and Google Calendar external-link button are ported for
    // row-contract parity even though no appointment carries a checklistHref/
    // googleEvent yet on mobile — they light up the moment one does.
    const when = feedRowWhen(item, todayISOStr);
    const tileSection = heroItemSectionId(item);
    const row = (holdProgress?: number) => (
      <ListItem
        key={item.id}
        holdProgress={holdProgress}
        className="gap-3 py-2.5"
        onPress={heroItemOpenTarget(item) ? () => openHeroItem(item) : undefined}
      >
        <ListItemLeading className="mt-0">
          <LeadingTile sectionId={tileSection} Icon={item.type === 'appointment' ? CalendarClock : sectionIconFor(tileSection)} />
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle>{item.title}</ListItemTitle>
          <ListItemMeta>
            {when && (
              <Text
                className={when.kind === 'overdue' ? 'text-caption text-destructive' : 'font-mono text-caption text-muted-foreground'}
                style={when.kind === 'time' ? { fontVariant: ['tabular-nums'] } : undefined}
              >
                {when.kind === 'overdue' ? when.text : formatTime12h(when.time)}
              </Text>
            )}
            <Text className="text-caption text-muted-foreground">{item.sourceLabel}</Text>
            {item.module && <ModuleRowTrailing moduleId={item.module.id} detail={item.module.detail} />}
          </ListItemMeta>
        </ListItemContent>
        <ListItemTrailing>
          {item.googleEvent?.html_link && (
            <Pressable
              onPress={() => Linking.openURL(item.googleEvent!.html_link!)}
              accessibilityRole="button"
              accessibilityLabel="Open in Google Calendar"
              hitSlop={8}
              className="items-center justify-center rounded-md border border-border bg-muted p-1.5"
            >
              <ExternalLink size={14} className="text-muted-foreground" />
            </Pressable>
          )}
          {item.checklistHref && (
            <Pressable
              onPress={() => router.push(item.checklistHref as Href)}
              accessibilityRole="button"
              className="flex-row items-center gap-0.5 rounded-md border border-border bg-muted px-2 py-1"
            >
              <Text className="text-xs font-medium text-foreground/80">Open</Text>
              <ChevronRight size={12} className="text-foreground/80" />
            </Pressable>
          )}
          <PersonAvatar userId={item.assignedTo} profiles={memberProfiles} size={22} />
        </ListItemTrailing>
      </ListItem>
    );
    // A household event: swipe right for directions, left to hide it from
    // Home, hold to edit it here (event-row-gestures.tsx).
    const event = item.groupEvent;
    if (event) {
      return (
        <EventRowGestures
          key={item.id}
          event={event}
          onEdit={() => {
            setEditingEvent(event);
            setEventModalOpen(true);
          }}
          onHide={() => {
            hideEvent(event.id);
            eventHideUndo.addAndShow(event.id);
          }}
        >
          {row}
        </EventRowGestures>
      );
    }
    return row();
  };

  if (cacheLoading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <Text className="text-body text-muted-foreground">Loading…</Text>
      </ScreenBackground>
    );
  }
  if (!group) {
    return <NoGroupScreen />;
  }

  // One page per queued item. HOUP-172 (item 6): a coarse countdown on a
  // timed item, warning-tinted when due within the hour; only for today's
  // timed items (an overdue item's time is a past day's). A dated
  // checklist's to-do opens its list in place, with its own meter.
  const nowCards: NowCardPagerItem[] = nowQueue.map((item) => {
    const { countdown, dueSoon, eyebrow } = nowCardTiming(item, now);
    const section = heroItemSectionId(item);
    const linkedId = taskChecklistsVisible && item.checklistHref ? item.task?.linked_checklist_id : null;
    const checklist = linkedId ? checklistsById[linkedId] : undefined;
    const checklistItems = checklist ? (checklistItemsByChecklistId[checklist.id] ?? []) : [];
    return {
      id: item.id,
      sectionId: section,
      Icon: item.type === 'appointment' ? CalendarClock : section === 'household' && item.type === 'reminder' ? Bell : sectionIconFor(section),
      eyebrow: eyebrow.text,
      eyebrowTone: eyebrow.tone,
      title: item.title,
      meta: (
        <>
          {item.dueTime && !item.overdue && (
            <Text className={`text-data-fragment ${dueSoon ? 'text-warning' : 'text-muted-foreground'}`} style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime12h(item.dueTime)}
              {countdown && countdown !== 'now' ? ` · ${countdown}` : ''}
            </Text>
          )}
          <Text className="text-caption text-muted-foreground">{item.sourceLabel}</Text>
          {item.module && <ModuleRowTrailing moduleId={item.module.id} detail={item.module.detail} />}
        </>
      ),
      progress: checklist ? completion(checklistItems) : null,
      body: checklist ? (
        <TaskChecklistPanel
          checklist={checklist}
          items={checklistItems}
          currentUserId={currentUserId}
          onOpenFull={() => openNowItem(item)}
        />
      ) : undefined,
      onOpen: heroItemOpenTarget(item) ? () => openNowItem(item) : undefined,
      onComplete: item.task && !item.task.done
        ? () => finishFromNowCard(item.task!)
        : item.module?.completable && !item.done
          ? () => finishModuleItem(item)
          : undefined,
      footer: item.task ? undefined : (
        <EventCardFooter item={item} onOpen={heroItemOpenTarget(item) ? () => openNowItem(item) : undefined} />
      ),
    };
  });
  const feedGroups = groupFeedItems(visibleHeroItems, todayISOStr);

  return (
    // Hearth v2: an open lens borrows its section's glow.
    <ScreenBackground sectionId={shownLens ? HOME_LENS_META[shownLens].sectionId : undefined}>
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* H1: one lede. Hearth v2 (Pulse): the Hero count sits on the ground
            under the coral glow; no card around it. */}
        <View className="relative gap-3 px-1">
          {/* HOUP-305: `gap-3` + shrink/truncate on the hint side, so a long
              location hint truncates instead of running into the date. */}
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-caption text-muted-foreground">{todayLabel}</Text>
            <View className="min-w-0 shrink flex-row items-center gap-2">
              <Pressable
                onPress={() => setCustomizeOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Customize summary"
                hitSlop={8}
              >
                <Settings2 size={16} className="text-muted-foreground" />
              </Pressable>
            </View>
          </View>
          {/* Hearth v2 (day ribbon): the weather sits in the top right beside
              the Hero and opens the hourly ribbon under it (features/home/sky.tsx). */}
          {(countEnabled || sky || skyNote) && (
            <View className="flex-row items-end justify-between gap-3">
              <View className="min-w-0 flex-1">
                {countEnabled &&
                  (progress.left === 0 ? (
                    <HeroLede
                      size="section"
                      value="All clear"
                      caption={progress.done > 0 ? `${progress.done} done today` : 'Nothing on today'}
                    />
                  ) : (
                    <HeroLede
                      size="home"
                      value={progress.left}
                      label={`of ${progress.total} left today`}
                      meter={{ done: progress.done, total: progress.total }}
                    />
                  ))}
              </View>
              {sky && (
                <SkyBlock weather={sky} headline={skyLine} open={ribbonOpen} onToggle={toggleRibbon} canExpand={ribbon.length > 0} />
              )}
              {skyNote && <SkyNote reason={skyNote} onSetLocation={() => router.push('/settings/global')} />}
            </View>
          )}
          {sky && ribbonOpen && ribbon.length > 0 && <DayRibbon hours={ribbon} />}
          {/* HOUP-172 (item 3): people line — who's on the hook today, current user first, plus an amber unassigned nudge. */}
          {(showWhosOnHook || showUnassignedChip) && (
            <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
              {showWhosOnHook &&
                assigneeIds.map((id) => (
                  <View key={id} className="flex-row items-center gap-1.5">
                    <PersonAvatar userId={id} profiles={memberProfiles} size={18} />
                    <Text className="text-body font-medium text-foreground">
                      {id === currentUserId ? 'You' : memberLabel(id, memberProfiles)}{' '}
                      <Text style={{ fontVariant: ['tabular-nums'] }}>{countFor(id)}</Text>
                    </Text>
                  </View>
                ))}
              {showUnassignedChip && (
                <View className="rounded-full bg-warning/15 px-2 py-0.5">
                  <Text className="text-caption font-medium text-warning" style={{ fontVariant: ['tabular-nums'] }}>
                    {unassigned} unassigned
                  </Text>
                </View>
              )}
            </View>
          )}
          {heroOn('streak') && streak >= 1 && (
            <View className="flex-row items-center gap-1.5">
              <Flame size={14} className="text-warning" />
              <Text className="text-body font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {streak}-day all-clear streak
              </Text>
            </View>
          )}
          {tips.map((tip) => (
            <View key={tip.key} className="flex-row items-center gap-2.5">
              <View className="h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-muted">
                <tip.Icon size={15} className="text-foreground" />
              </View>
              <Text className="min-w-0 flex-1 text-body text-foreground">{tip.text}</Text>
            </View>
          ))}
          {/* Hearth v2: the home-group pulse tiles are opt-in shortcuts, one
              compact row of at most SHORTCUTS_CAP (web summary-hero.tsx). */}
          {shortcuts.length > 0 && (
            <View className="flex-row gap-2">
              {shortcuts.map((tile) => (
                <View key={tile.key} className="min-w-0 flex-1">
                  {tile.node}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Hearth v2 (Pulse): the Now card, paging through the next few
            things. Tap opens the item; only a task or reminder can be slid to
            finish, and finishing celebrates, then brings the next one in. */}
        {nowCards.length > 0 && (
          <View style={showIf(!shownLens)}>
            <NowCardPager items={nowCards} />
          </View>
        )}

        {/* Meal plan: tonight's dinner, one row (hub.meals). */}
        <TonightMeal groupId={group?.id} style={showIf(!shownLens)} />

        {/* Hearth v2: filtered to a shortcut, Home shows only that Space, so
            the feed steps aside. Otherwise the feed: its title is
            the range picker and the filter button sits at its end (H5, the
            controls on the line they scope), then rows grouped under
            Earlier / Today / Tomorrow / weekday headers. */}
        {agendaVisible && (
          // Hearth v2 (Feed, H4): the feed sits on the ground and each day is
          // its own card under a micro-label day header, mirroring web.
          <View className="gap-3" style={showIf(!shownLens)}>
            <FeedControls
              range={heroRange}
              onRangeChange={setHeroRange}
              count={openCount(visibleHeroItems)}
              rangeCounts={rangeCounts}
              typeOptions={typeOptions}
              type={activeType}
              onTypeChange={setTypeFilter}
              mineOnly={mineOnly}
              onMineChange={setMineOnly}
              filtered={isHeroFeedFiltered(feedFilter)}
            />

            {visibleHeroItems.length === 0 ? (
              <Card className="rounded-3xl px-4">
                <Text className="py-2 text-center text-body text-muted-foreground">
                  {heroItems.length === 0
                    ? householdVisible
                      ? 'Nothing on the agenda. Tap + to add a task.'
                      : 'Nothing on the agenda.'
                    : 'No items match the current filters.'}
                </Text>
              </Card>
            ) : (
              feedGroups.map((feedGroup) => (
                <View key={feedGroup.key} className="gap-1.5">
                  <FeedHeader
                    groupKey={feedGroup.key}
                    label={feedGroup.label}
                    onAdd={/^\d{4}-\d{2}-\d{2}$/.test(feedGroup.key) && addOnDayItems(feedGroup.key).length ? (anchor) => setAddOn({ anchor, date: feedGroup.key }) : undefined}
                  />
                  <Card className="gap-0 rounded-3xl py-0">
                    <View className="px-4">
                      <DividedRows>{feedGroup.items.map(renderHeroRow)}</DividedRows>
                    </View>
                  </Card>
                </View>
              ))
            )}
            {/* The way into the full Tasks page, as a quiet link under the
                feed (same as web's today-hero). */}
            {householdVisible && (
              <Pressable
                onPress={() => router.push('/tasks')}
                accessibilityRole="link"
                className="min-h-[44px] flex-row items-center gap-1 self-start px-1"
              >
                <Text className="text-body font-medium text-primary">All tasks</Text>
                <ChevronRight size={16} className="text-primary" />
              </Pressable>
            )}
          </View>
        )}

        {/* Hearth v2: Spaces, the sections' own tiles, under the feed. Home
            is one dashboard: Budget and Bills are always here, and a
            shortcut filters Home down to its own Space, expanded (same
            order as web: Groceries, Budget, Bills, Setup, Home Search). */}
        <Text className="-mb-1 px-1 pt-2 text-micro-label uppercase text-muted-foreground" style={showIf(!shownLens)}>
          Spaces
        </Text>
        {!hidden.includes('groceries') && (
          <View style={showIf(!shownLens || shownLens === 'shoppingList')}>
            <GroceriesWidget group={group} currentUserId={currentUserId} expanded={shownLens === 'shoppingList'} />
          </View>
        )}
        {costsVisible && (
          <View style={showIf(shownLens === 'budgetPulse' || (!shownLens && heroOn('spaceBudget')))}>
            <BudgetSpace
              group={group}
              currentUserId={currentUserId}
              costItems={costItemsList}
              budgetCents={budgetCents}
              expanded={shownLens === 'budgetPulse'}
              now={now}
            />
          </View>
        )}
        {costsVisible && (
          <View style={showIf(shownLens === 'billsDue' || (!shownLens && heroOn('spaceBills')))}>
            <BillsSpace costItems={costItemsList} expanded={shownLens === 'billsDue'} now={now} />
          </View>
        )}
        {shownLens === 'shopperWatch' && <ShopperTile group={group} expanded />}
        <View className="flex-row flex-wrap gap-3" style={showIf(!shownLens)}>
          {!hidden.includes('setup') && <SetupTile group={group} />}
          {searchVisible && <HomeSearchTile apartments={apartmentsWithScore} appointments={appointmentsList} />}
          {!hidden.includes('shopper') && <ShopperTile group={group} />}
          {!hidden.includes('assistant') && <AssistantTile />}
        </View>

        <Moment
          open={allClearOpen}
          onDismiss={() => setAllClearOpen(false)}
          title="All clear"
          caption="Everything on today is done."
          detail={heroOn('streak') && streak >= 1 ? `${streak + 1}-day all-clear streak` : undefined}
        />

        <HeroCustomizeSheet
          open={customizeOpen}
          onOpenChange={setCustomizeOpen}
          config={heroConfig}
          onToggle={setModule}
          countdown={countdown}
          onCountdownChange={setCountdown}
          onCountdownFlush={flushCountdown}
        />
  
        <ActionMenu
          anchor={addOn?.anchor ?? null}
          onClose={() => setAddOn(null)}
          items={addOn ? addOnDayItems(addOn.date).map((it) => ({ ...it, onPress: () => { setAddOn(null); it.onPress(); } })) : []}
        />

        {newCostOn && (
          <CostModal
            key={newCostOn}
            open
            groupId={group.id}
            currentUserId={currentUserId}
            defaultStartDate={newCostOn}
            onClose={() => setNewCostOn(null)}
            onSave={(item) => {
              writeCost(item);
              setNewCostOn(null);
            }}
          />
        )}

        <HouseholdTaskModal
          key={editingTask?.id ?? `new-${newTaskDue ?? ''}`}
          initialDueDate={editingTask ? undefined : newTaskDue}
          open={modalOpen}
          task={editingTask}
          groupId={group.id}
          currentUserId={currentUserId}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          // HOUP-191: `key={editingTask?.id ?? 'new'}` remounts the sheet
          // the instant `editingTask` clears — clearing it in the same tick
          // as `setModalOpen(false)` used to skip the 250ms exit animation
          // entirely (remounted instance starts already-closed), and on Save
          // let the store write reorder/remove the row while the old sheet
          // was still visible above it. Every path below closes immediately
          // and defers clearing `editingTask` (plus any write) until the
          // exit animation finishes.
          onClose={() => {
            setModalOpen(false);
            setTimeout(() => {
              setEditingTask(undefined);
              setNewTaskDue(undefined);
            }, MOTION_DURATIONS_MS.exit);
          }}
          onSave={(saved) => {
            setModalOpen(false);
            setTimeout(() => {
              writeRow(saved);
              setEditingTask(undefined);
              setNewTaskDue(undefined);
            }, MOTION_DURATIONS_MS.exit);
          }}
          onDelete={(taskId) => {
            setModalOpen(false);
            const deleted = editingTask;
            setTimeout(() => {
              softDeleteRow(taskId);
              if (deleted) taskDeleteUndo.addAndShow(deleted);
              setEditingTask(undefined);
            }, MOTION_DURATIONS_MS.exit);
          }}
        />

        {eventsVisible && (
          <EventModal
            key={editingEvent?.id ?? `no-event-${newEventOn ?? ''}`}
            defaultDate={editingEvent ? undefined : newEventOn}
            open={eventModalOpen}
            event={editingEvent ?? undefined}
            groupId={group.id}
            showBudget={modules.feature('calendar.budget')}
            costCents={linkedCostOf(editingEvent)?.amount ?? null}
            onClose={() => {
              setEventModalOpen(false);
              setTimeout(() => {
                setEditingEvent(null);
                setNewEventOn(undefined);
              }, MOTION_DURATIONS_MS.exit);
            }}
            onSave={(saved, costCents) => {
              setEventModalOpen(false);
              setTimeout(() => {
                saveEvent(saved, costCents);
                setEditingEvent(null);
              }, MOTION_DURATIONS_MS.exit);
            }}
            onDelete={() => {
              setEventModalOpen(false);
              const deleted = editingEvent;
              setTimeout(() => {
                if (deleted) deleteEvent(deleted);
                setEditingEvent(null);
              }, MOTION_DURATIONS_MS.exit);
            }}
          />
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}
