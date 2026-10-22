// HOUP-82: native Costs & Budget — live data via HOUP-86's native
// StoreEnvironment + useDataCache() provider. Reuses @homeup/core's cost math
// and Legend store verbatim (HOUP-73) — no new core code beyond HOUP-174's
// grocery-sessions em-dash fix. Faithful-but-focused scope per the approved
// plan: category-grouped list, a local budget meter, the period toggle, a
// this-month filter, and an add/edit bottom sheet.
// Deferred to a named follow-up (not dropped): cost documents, who-pays split,
// per-item comments, the 12-month chart tile (HOUP-152) — apps/web/src/app/
// costs/page.tsx and cost-chart.tsx still own those.
// HOUP-174 screen polish: KPI strip (vs last month / rest of year / YTD,
// math ported from cost-chart.tsx), search, a header row mirroring
// groceries/index.tsx (lede left, Select + Add right), a width-capped budget
// meter (H3) with a "Set a budget" link / "Nd left" tail, and the "From your
// other sections" rent/setup suggestion panel ported from apps/web/src/app/
// costs/page.tsx.
//
// HOUP-208: ScrollView -> FlashList. The category-grouped list (header + its
// CostRows) now flattens into one array via @homeup/ui's flattenGroups/
// SectionRow (the HOUP-205/206 pattern) instead of a `View`-per-category
// `.map()`; everything above the list (lede, KPIs, budget meter, period
// toggle, search) hoists into `ListHeaderComponent`, and the "from your other
// sections" suggestion panel becomes `ListFooterComponent` so both still
// scroll with the list.
import * as React from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { use$ } from '@legendapp/state/react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  Button,
  Card,
  HeroLede,
  Input,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemTitle,
  ProgressBar,
  PulseTile,
  ScreenBackground,
  SectionSearchBar,
  SearchablePicker,
  SegmentedControl,
  cn,
  groupFrameClass,
  rowSpacingClassName,
  toast,
  type PickerOption,
  type SectionRow,
  haptics,
  useThemeMaterial,
} from '@homeup/ui';
import {
  CATEGORY_META,
  CADENCE_LABEL,
  PERIOD_LABEL,
  amountForPeriod,
  apartments$,
  costItems$,
  costSectionSuggestions,
  deleteCostReminders,
  formatMoney,
  isOneOff,
  monthlyAmount,
  monthlyProjection,
  parseLocalDateOnly,
  setupItems$,
  stepBackByCategory,
  syncCostReminders,
  todayISO,
  totalForPeriod,
  totalOneOff,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useModules,
  UpOverviewProvider,
  type Apartment,
  type CostCadence,
  type CostCategory,
  type CostItem,
  type Period,
  type SetupItem,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';
import { CostDashboard } from '@/features/costs/cost-dashboard';
import { CostRow, categoryTint } from '@/features/costs/cost-card';
import { CostModal } from '@/features/costs/cost-modal';
import { UpSpendingCard } from '@/features/costs/up-spending';
import { upBankApi } from '@/features/costs/up-bank-api';
import { sectionIconFor } from '@/lib/section-icons';

const PERIODS: Period[] = ['weekly', 'monthly', 'yearly'];
const CADENCE_OPTIONS: CostCadence[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'one_off'];
const CATEGORY_OPTIONS = Object.keys(CATEGORY_META) as CostCategory[];
const CATEGORY_PICKER_OPTIONS: PickerOption[] = CATEGORY_OPTIONS.map((c) => ({
  value: c,
  primary: CATEGORY_META[c].label,
}));
const CADENCE_SEGMENTS = CADENCE_OPTIONS.map((c) => ({ value: c, label: CADENCE_LABEL[c] }));

type CostListRow =
  | SectionRow<CostItem>
  | { kind: 'quick-add'; id: string; category: CostCategory };

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

function MemberAvatar({ userId, profiles, size = 20 }: { userId: string | null; profiles: MemberProfiles; size?: number }) {
  const label = memberLabel(userId, profiles);
  const uri = userId ? profiles[userId]?.avatar ?? null : null;

  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-muted">
      <Text style={{ fontSize: size * 0.42 }} className="font-medium uppercase text-muted-foreground">
        {label.charAt(0)}
      </Text>
    </View>
  );
}

export default function CostsSectionScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useThemeMaterial().scheme;
  const { group, currentUserId, userSettings, groupMembers, memberProfiles, loading: cacheLoading } = useDataCache();

  const items$ = costItems$(group?.id);
  useReconnectSync(items$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);

  const items = use$(() =>
    Object.values(items$.get() ?? {})
      .filter((i): i is CostItem => !!i && !i.deleted)
      // Drop $0 grocery "actual" lines — leftovers from sessions started then undone.
      .filter((i) => !(i.category === 'grocery_estimate' && !i.is_estimate && (i.amount ?? 0) === 0))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  );
  const storeLoaded = useStoreLoaded(items$);

  // "From your other sections" data sources (HOUP-174) — same stores web's
  // page.tsx reads, both platform-agnostic Legend stores from @homeup/core.
  const modules = useModules();
  // Modules: the rent suggestion needs costs and search, the setup one costs and
  // setup (module-features.ts). Off means its source store isn't read at all.
  const suggestRent = modules.feature('costs.suggest-rent');
  const suggestSetup = modules.feature('costs.suggest-setup');
  const apts$ = apartments$(suggestRent ? group?.id : undefined);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const setup$ = setupItems$(suggestSetup ? group?.id : undefined);
  const setupTotalCents = use$(() =>
    Object.values(setup$.get() ?? {})
      .filter((i): i is SetupItem => !!i && !i.deleted)
      .reduce((sum, i) => sum + (i.est_price ?? 0), 0) * 100
  );

  const [period, setPeriod] = React.useState<Period>('monthly');
  // HOUP-277: the chart's month picker (below) drives the list filter
  // directly, no separate toggle — null means "current month" (its default).
  const [selectedMonthIdx, setSelectedMonthIdx] = React.useState<number | null>(null);
  const [search, setSearch] = React.useState('');
  const [budget, setBudget] = React.useState<number | null>(null);
  const [editingBudget, setEditingBudget] = React.useState(false);
  const [budgetDraft, setBudgetDraft] = React.useState('');
  const [hideSectionSuggestions, setHideSectionSuggestions] = React.useState(false);
  // HOUP-217: category tap-to-filter, lifted so the dashboard's breakdown rows
  // (rendered inside listHeader below) and the list's visibleItems derivation
  // share one source of truth — mirrors apps/web/src/app/costs/page.tsx's
  // selectedCategory. List-only filter; chart/totals stay full-set.
  const [selectedCategory, setSelectedCategory] = React.useState<CostCategory | null>(null);
  // HOUP-284: filtering swings flatData's height by hundreds of dp, which used
  // to leave the raw scroll offset clamped to an arbitrary spot. `listRef` +
  // FlashList's `maintainVisibleContentPosition` (below) anchor the viewport
  // across that resize; keep the ref in case on-device testing finds a case
  // it doesn't settle (fallback: listRef.current?.scrollToOffset/scrollToIndex
  // re-anchor to the list boundary — not wired speculatively).
  const listRef = React.useRef<FlashListRef<CostListRow>>(null);
  const handleSelectCategory = (category: CostCategory) =>
    setSelectedCategory((prev) => (prev === category ? null : category));
  const [collapsedCats, setCollapsedCats] = React.useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkSheet, setBulkSheet] = React.useState<'category' | 'cadence' | 'payer' | null>(null);
  const [bulkCategory, setBulkCategory] = React.useState<CostCategory>('purchase');
  const [bulkCadence, setBulkCadence] = React.useState<CostCadence>('monthly');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<CostItem | undefined>();
  // Two "Add" opens in a row both key to 'new' — this nonce forces a remount
  // on each open so CostModal's useState initializers re-seed a blank form.
  const [addNonce, setAddNonce] = React.useState(0);

  // FLUX-65 parity: period + monthly budget target sync via user_settings —
  // native has no localStorage mirror, so the DB is the only source. Hydrate
  // once cacheLoading resolves.
  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (cacheLoading || hydrated.current) return;
    hydrated.current = true;
    const dbPeriod = userSettings?.costs_period;
    if (dbPeriod === 'weekly' || dbPeriod === 'monthly' || dbPeriod === 'yearly') setPeriod(dbPeriod);
    if (userSettings?.costs_budget_monthly != null) setBudget(userSettings.costs_budget_monthly / 100);
    if (userSettings?.costs_hide_section_suggestions != null) {
      setHideSectionSuggestions(userSettings.costs_hide_section_suggestions);
    }
  }, [cacheLoading, userSettings]);

  const persistSettings = React.useCallback(async (payload: Record<string, unknown>) => {
    try {
      const supabase = getCurrentSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...payload }, { onConflict: 'user_id' });
    } catch {
      // Offline, or the client isn't bound yet — the local state already
      // reflects the change; the next successful edit will persist it.
    }
  }, []);

  const changePeriod = (p: Period) => {
    setPeriod(p);
    void persistSettings({ costs_period: p });
  };

  // Same toggle-off-on-repeat-tap behavior the chart's bars had locally
  // before HOUP-277 lifted the selection up to the screen.
  const selectMonth = (idx: number) => setSelectedMonthIdx((cur) => (cur === idx ? null : idx));

  const saveBudget = (value: number | null) => {
    setBudget(value);
    setEditingBudget(false);
    void persistSettings({ costs_budget_monthly: value && value > 0 ? Math.round(value * 100) : null });
  };

  const dismissSectionSuggestions = () => {
    setHideSectionSuggestions(true);
    void persistSettings({ costs_hide_section_suggestions: true });
  };

  // HOUP-139: was a silent delete — now a 5s Undo toast (soft-delete already
  // makes Undo a clean local un-hide, no confirm needed for a single row).
  // HOUP-141: also fire-and-forget the reminder cleanup web's handleRequestDelete
  // does, so a deleted cost doesn't orphan its contract/discount reminder tasks.
  const handleDelete = React.useCallback(
    (item: CostItem) => {
      haptics.remove();
      softDeleteRow(item.id);
      toast.message(`Removed "${item.name}"`, {
        duration: 5000,
        action: { label: 'Undo', onPress: () => patchRow(item.id, { deleted: false }) },
      });
      try {
        void deleteCostReminders(item, getCurrentSupabaseClient());
      } catch {
        // Client not bound yet (cold boot) — nothing to clean up remotely.
      }
    },
    [patchRow, softDeleteRow]
  );

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleCatCollapsed = (category: string) =>
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const bulkUpdate = (payloadFor: Partial<CostItem> | ((item: CostItem) => Partial<CostItem>)) => {
    const targets = items.filter((i) => selectedIds.has(i.id));
    if (targets.length === 0) return;
    let supabaseBound = false;
    let supabase: ReturnType<typeof getCurrentSupabaseClient> | null = null;

    targets.forEach((item) => {
      const payload = typeof payloadFor === 'function' ? payloadFor(item) : payloadFor;
      const updated = { ...item, ...payload } as CostItem;
      patchRow(item.id, payload);
      if (updated.end_date || updated.discount_end_date || item.end_date || item.discount_end_date) {
        try {
          if (!supabaseBound) {
            supabase = getCurrentSupabaseClient();
            supabaseBound = true;
          }
          if (supabase) void syncCostReminders(updated, supabase).catch(() => {});
        } catch {
          // Client not bound yet; local edits still commit.
        }
      }
    });

    setBulkSheet(null);
    exitSelectMode();
  };

  const bulkDelete = () => {
    selectedIds.forEach((id) => {
      const item = items.find((i) => i.id === id);
      softDeleteRow(id);
      if (item) {
        try {
          void deleteCostReminders(item, getCurrentSupabaseClient());
        } catch {
          // Client not bound yet — nothing to clean up remotely.
        }
      }
    });
    exitSelectMode();
  };

  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  // HOUP-277: the month picked in the chart below (defaulting to the real
  // current month) is what actually windows the list — startOfMonth/endOfMonth
  // above stay the *real* current month for the budget meter / MoM tile.
  const selectedMonthStart =
    selectedMonthIdx !== null ? new Date(today.getFullYear(), selectedMonthIdx, 1) : startOfMonth;
  const selectedMonthEnd = new Date(selectedMonthStart.getFullYear(), selectedMonthStart.getMonth() + 1, 0);

  // Search narrows every derived total below (not just the rendered list) —
  // mirrors apps/web/src/app/costs/page.tsx's searchedItems (only the
  // "this month" toggle + category tap are visible-only filters, see
  // visibleItems further down).
  const searchedItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.provider ?? '').toLowerCase().includes(q) ||
        (i.notes ?? '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const recurring = searchedItems.filter((i) => !isOneOff(i));

  // HOUP-218 "Who pays" split — ported from apps/web/src/app/costs/page.tsx's
  // `byPayer`: sums the selected period's amount per `assigned_to` over the
  // recurring set (one-offs aren't a recurring split). Unlike web (sorted by
  // amount only), the ticket calls for the unassigned bucket pinned last
  // regardless of amount, so it doesn't read as "the biggest payer."
  const [whoPaysCollapsed, setWhoPaysCollapsed] = React.useState(true);
  const byPayer = React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const i of recurring) {
      const key = i.assigned_to ?? '';
      totals.set(key, (totals.get(key) ?? 0) + amountForPeriod(i, period));
    }
    const assigned = [...totals.entries()].filter(([uid]) => uid !== '').sort((a, b) => b[1] - a[1]);
    const unassigned = totals.get('');
    return unassigned != null ? [...assigned, ['', unassigned] as [string, number]] : assigned;
  }, [recurring, period]);

  const handleAssign = React.useCallback((id: string, userId: string) => patchRow(id, { assigned_to: userId || null }), [patchRow]);

  // Budget meter is always-monthly (H1: one lede), independent of the period
  // toggle below — mirrors apps/web's hero math exactly (HOUP-141): non-estimate
  // recurring costs pass through unchanged; is_estimate categories step back via
  // the shared stepBackByCategory rule (max(estimate, actual) this month) instead
  // of double-counting the full forecast alongside separately-summed one-offs.
  const stepBack = stepBackByCategory(searchedItems, startOfMonth, startOfMonth);
  const stepBackMonthlyTotal = Object.values(stepBack).reduce((sum, r) => sum + r.effective, 0);
  const monthlyTotal =
    recurring.filter((i) => !i.is_estimate).reduce((sum, i) => sum + monthlyAmount(i), 0) + stepBackMonthlyTotal;
  const budgetCents = budget ? budget * 100 : 0;
  const budgetDelta = budgetCents - monthlyTotal;
  const daysLeft = endOfMonth.getDate() - today.getDate();

  // vs-last-month KPI tile (HOUP-174, ported from apps/web/src/app/costs/
  // page.tsx:334-353 + cost-chart.tsx's tile). monthlyProjection projects
  // *forward* from `from`, so anchor at the first of the previous month with a
  // 2-month window: [prevMonth, currentMonth]. Pre-filter one-offs with a
  // missing/out-of-window start_date so they can't inflate a false MoM delta —
  // recurring items and grocery items (estimate or actual) pass through
  // unfiltered (the function already window-guards grocery actuals).
  const startOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const momItems = searchedItems.filter((i) => {
    if (i.cadence !== 'one_off' || i.category === 'grocery_estimate') return true;
    if (!i.start_date) return false;
    const d = parseLocalDateOnly(i.start_date);
    return d >= startOfPrevMonth && d <= endOfCurrentMonth;
  });
  const [prevMonthBucket, currentMonthBucket] = monthlyProjection(momItems, startOfPrevMonth, 2, today);
  const hasPrevMonthData = prevMonthBucket.total > 0;
  const momDelta = currentMonthBucket.total - prevMonthBucket.total;
  // H2: a month-over-month change crosses no budget, so it is not a status;
  // the tile reads neutral, sign first (mirrors web's cost-chart.tsx).

  // Rest-of-year / year-to-date KPI tiles (HOUP-174, ported from cost-chart.tsx's
  // `ytd`/`projectedRestOfYear`, minus the 12-month chart itself — HOUP-152).
  const yearBuckets = monthlyProjection(searchedItems, new Date(today.getFullYear(), 0, 1), 12, today);
  const currentMonthIdx = today.getMonth();
  const yearToDate = yearBuckets.slice(0, currentMonthIdx + 1).reduce((sum, b) => sum + b.total, 0);
  const projectedRestOfYear = yearBuckets.slice(currentMonthIdx + 1).reduce((sum, b) => sum + b.total, 0);

  // The picked month narrows only the rendered list — recurring items always
  // show (they recur monthly); only dated one-offs are windowed.
  const visibleItems = searchedItems.filter((i) => {
    if (selectedCategory && i.category !== selectedCategory) return false;
    if (isOneOff(i)) {
      if (!i.start_date) return false;
      const d = parseLocalDateOnly(i.start_date);
      return d >= selectedMonthStart && d <= selectedMonthEnd;
    }
    return true;
  });

  // HOUP-208 mount-time audit finding: this reduce used to run unmemoized on
  // every render (every search keystroke, every select-mode toggle) — cheap
  // per household-scale dataset, but memoizing costs nothing and matches the
  // rest of this screen's derived-value convention.
  const grouped = React.useMemo(
    () =>
      visibleItems.reduce<Record<string, CostItem[]>>((acc, i) => {
        (acc[i.category] ??= []).push(i);
        return acc;
      }, {}),
    [visibleItems]
  );

  // HOUP-208: flatten the category-grouped list into one FlashList data array
  // (the HOUP-205/206 pattern). Each category's aggregate label (period total
  // + one-off total) is category-specific data the shared SectionRow header
  // shape doesn't carry, so it's looked up by category key inside renderItem
  // rather than widening the shared type for one screen.
  const categoryAggregateLabel = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const [cat, catItems] of Object.entries(grouped)) {
      const catRecurring = catItems.filter((i) => !isOneOff(i));
      const catPeriodTotal = totalForPeriod(catRecurring, period);
      const catOnce = totalOneOff(catItems.filter(isOneOff));
      // H6/copy ban: filter blank parts before joining so an empty half never
      // leaves a leading/trailing/doubled " · " (mirrors packages/core/src/
      // hooks/use-global-search-index.ts's `.filter(Boolean).join` pattern).
      map.set(
        cat,
        [catPeriodTotal > 0 ? formatMoney(catPeriodTotal) : null, catOnce > 0 ? `${formatMoney(catOnce)} once` : null]
          .filter(Boolean)
          .join(' · ')
      );
    }
    return map;
  }, [grouped, period]);

  const flatData = React.useMemo<CostListRow[]>(() => {
    const out: CostListRow[] = [];
    for (const [cat, catItems] of Object.entries(grouped)) {
      const category = cat as CostCategory;
      out.push({
        kind: 'group-header',
        id: `group-header:${cat}`,
        label: CATEGORY_META[category].label,
        tone: 'muted',
        count: catItems.length,
      });

      if (collapsedCats.has(cat)) continue;

      const lastIndex = catItems.length - 1;
      catItems.forEach((item, index) => {
        out.push({
          kind: 'row',
          id: item.id,
          item,
          pos: catItems.length === 1 ? 'only' : index === 0 ? 'first' : index === lastIndex ? 'last' : 'middle',
        });
      });

      if (!selectMode) out.push({ kind: 'quick-add', id: `quick-add:${cat}`, category });
    }
    return out;
  }, [grouped, collapsedCats, selectMode]);

  // "From your other sections" suggestion data (HOUP-174, ported from
  // apps/web/src/app/costs/page.tsx:216-268/492-530).
  const chosenApt = apartments.find((a) => a.id === group?.chosen_apartment_id);
  const rentWeeklyCents = chosenApt?.rent_per_week ? Math.round(chosenApt.rent_per_week * 100) : 0;
  const { rent: showRentSuggestion, setup: showSetupSuggestion } = costSectionSuggestions({
    items,
    rentWeeklyCents,
    setupTotalCents,
    rentEnabled: suggestRent,
    setupEnabled: suggestSetup,
  });

  const addLine = (line: Partial<CostItem> & Pick<CostItem, 'name' | 'category' | 'amount' | 'cadence'>) => {
    if (!group?.id) return;
    const isOneOffActual = line.cadence === 'one_off' && !(line.is_estimate ?? false);
    writeRow({
      id: randomUUID(),
      group_id: group.id,
      is_estimate: false,
      start_date: isOneOffActual ? todayISO() : null,
      end_date: null,
      discount_end_date: null,
      provider: null,
      assigned_to: null,
      linked_section: null,
      notes: null,
      sort_order: 0,
      created_by: currentUserId,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      ...line,
    });
  };

  const addRentLine = () => {
    if (!rentWeeklyCents) return;
    addLine({ name: 'Rent', category: 'rent', amount: rentWeeklyCents, cadence: 'weekly', linked_section: 'home_search' });
  };

  const addSetupLine = () => {
    if (!setupTotalCents) return;
    addLine({
      name: 'Home setup',
      category: 'moving',
      amount: setupTotalCents,
      cadence: 'one_off',
      is_estimate: true,
      linked_section: 'home_setup',
    });
  };

  const quickAdd = (category: CostCategory, name: string, dollars: string) => {
    const amount = Math.round(parseFloat(dollars || '0') * 100);
    addLine({
      name,
      category,
      amount: Number.isFinite(amount) ? amount : 0,
      cadence: 'one_off',
      is_estimate: false,
    });
  };

  const isEmptyList = items.length === 0;
  const isNoMatch = !isEmptyList && Object.keys(grouped).length === 0;

  // HOUP-208 fix: these two useMemo calls (and the derived consts above) MUST
  // stay before the cacheLoading/!group early returns below — Rules of Hooks
  // forbids calling a hook conditionally, and an early return before a hook
  // call makes it conditional. (A prior draft of this migration placed them
  // after the guards; caught by `react-hooks/rules-of-hooks` during `npm run
  // lint`.)
  //
  // Memoized (not an inline element) so the search/budget-draft Inputs inside
  // never remount and lose focus mid-type — matches tasks/groceries' own
  // ListHeaderComponent convention.
  const listHeader = React.useMemo(
    () => (
    <View className="gap-4 pb-4">
      {/* Header row (Select + Add right) — mirrors
          apps/mobile/src/app/(tabs)/groceries/index.tsx's header row structure.
          Hearth v2 (Pulse): the month's total is the Hero lede beneath it. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-micro-label uppercase text-muted-foreground">Costs</Text>
        <View className="flex-row items-center gap-2">
          <Button
            size="sm"
            variant={selectMode ? 'default' : 'outline'}
            onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          >
            {selectMode ? `${selectedIds.size} selected` : 'Select'}
          </Button>
          <Button
            size="sm"
            onPress={() => {
              setEditingItem(undefined);
              setAddNonce((n) => n + 1);
              setModalOpen(true);
            }}
          >
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Add</Text>
          </Button>
        </View>
      </View>
      <HeroLede
        value={formatMoney(monthlyTotal)}
        label={budget != null ? `of ${formatMoney(budgetCents)} planned` : 'this month'}
        tone={budget != null && budgetDelta < 0 ? 'danger' : 'neutral'}
      />

      {/* Budget meter (H3: ~52px inline meter next to its label, never
          edge-to-edge) — sits directly under the monthly-total lede it
          measures, paired with its delta line instead of alone in a card. */}
      {editingBudget ? (
        <View className="flex-row items-center gap-2">
          <Input
            autoFocus
            keyboardType="decimal-pad"
            value={budgetDraft}
            onChangeText={setBudgetDraft}
            placeholder="Monthly budget"
            className="flex-1"
            onSubmitEditing={() => saveBudget(budgetDraft ? Number(budgetDraft) : null)}
          />
          <Button size="sm" variant="outline" onPress={() => saveBudget(budgetDraft ? Number(budgetDraft) : null)}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setEditingBudget(false)}>
            Cancel
          </Button>
        </View>
      ) : budget != null ? (
        <Pressable
          onPress={() => { setBudgetDraft(String(budget)); setEditingBudget(true); }}
          accessibilityRole="button"
          accessibilityLabel="Edit monthly budget"
          className="min-h-11 flex-row items-center gap-2"
        >
          <ProgressBar
            value={monthlyTotal}
            total={budgetCents}
            fillClassName={budgetDelta < 0 ? 'bg-destructive' : 'bg-success'}
            className="w-[52px]"
          />
          <Text
            className={cn('flex-1 text-caption', budgetDelta < 0 ? 'text-destructive' : 'text-success')}
            style={{ fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {budgetDelta < 0 ? `${formatMoney(-budgetDelta)} over plan` : `${formatMoney(budgetDelta)} under plan`}
            {budgetDelta >= 0 && <Text className="text-muted-foreground"> · {daysLeft}d left</Text>}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => { setBudgetDraft(''); setEditingBudget(true); }}
          accessibilityRole="button"
          className="min-h-11 justify-center self-start"
        >
          <Text className="text-caption font-medium text-primary">Set a budget</Text>
        </Pressable>
      )}

      {/* KPI strip (HOUP-174) — vs last month / rest of year / year to date,
          ported from apps/web/src/app/costs/cost-chart.tsx's tile row. The
          12-month chart itself stays out of scope (HOUP-152). */}
      <View className="flex-row gap-2">
        <PulseTile
          label={hasPrevMonthData ? `vs ${prevMonthBucket.label}` : 'vs last month'}
          className="flex-1"
          value={
            hasPrevMonthData
              ? momDelta === 0
                ? formatMoney(0)
                : `${momDelta > 0 ? '+' : '−'}${formatMoney(Math.abs(momDelta))}`
              : '–'
          }
        />
        <PulseTile label="Rest of year" value={formatMoney(projectedRestOfYear)} className="flex-1" />
        <PulseTile label="Year to date" value={formatMoney(yearToDate)} className="flex-1" />
      </View>

      {/* 12-month chart + categories breakdown (HOUP-217), ported from
          apps/web/src/app/costs/cost-chart.tsx's CostDashboard (chart +
          breakdown sections only — the hero/KPI/budget-edit half stays above,
          already ported separately by HOUP-174). */}
      <CostDashboard
        buckets={yearBuckets}
        currentMonthIdx={currentMonthIdx}
        budgetCents={budgetCents}
        selectedCategory={selectedCategory}
        onSelectCategory={handleSelectCategory}
        selectedMonthIdx={selectedMonthIdx}
        onSelectMonth={selectMonth}
      />

      {/* Up Bank connector: this month's spending from the person's Up account. */}
      {modules.server('connectors.up-bank') && (
        <UpSpendingCard
          currentUserId={currentUserId ?? null}
          nameOf={(uid) => memberLabel(uid, memberProfiles)}
          items={items}
          onSetAmount={(item, cents) => patchRow(item.id, { amount: cents })}
        />
      )}

      {/* The list's controls sit above what they act on (H5): search, then the
          period the totals below are shown in (Who pays + category totals).
          Mirrors web's costs page. */}
      <SectionSearchBar value={search} onChange={setSearch} placeholder="Search costs…" />
      <SegmentedControl
        options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        value={period}
        onChange={changePeriod}
        accessibilityLabel="Show totals"
      />

      {/* "Who pays" split (HOUP-218) — collapsed by default, demoted like
          web's page.tsx panel: a compact disclosure, not another KPI tile. */}
      {byPayer.length > 0 && (
        <Card size="sm" className="rounded-3xl">
          <Pressable
            onPress={() => setWhoPaysCollapsed((c) => !c)}
            accessibilityRole="button"
            accessibilityState={{ expanded: !whoPaysCollapsed }}
            className="min-h-8 flex-row items-center gap-1.5 px-4"
          >
            {whoPaysCollapsed ? (
              <ChevronRight size={14} className="text-muted-foreground" />
            ) : (
              <ChevronDown size={14} className="text-muted-foreground" />
            )}
            <Text className="text-sm font-medium text-foreground">Who pays</Text>
          </Pressable>
          {!whoPaysCollapsed && (
            <View className="gap-2 px-4">
              {byPayer.map(([uid, amt]) => (
                <View key={uid || 'unassigned'} className="flex-row items-center gap-2">
                  <MemberAvatar userId={uid || null} profiles={memberProfiles} size={20} />
                  <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                    {memberLabel(uid || null, memberProfiles)}
                  </Text>
                  <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    {formatMoney(amt)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>
      )}


      {isEmptyList && (
        <Card>
          <Text className="px-4 text-center text-body text-muted-foreground">
            No costs yet. Add your rent, utilities, internet, and more.
          </Text>
        </Card>
      )}
      {isNoMatch && (
        <Card>
          <Text className="px-4 text-center text-body text-muted-foreground">
            No costs{' '}
            {search.trim()
              ? 'match your search'
              : selectedCategory
                ? 'match this filter'
                : `in ${selectedMonthStart.toLocaleString('default', { month: 'long' })}`}
            .
          </Text>
        </Card>
      )}
    </View>
    ),
    [
      monthlyTotal, selectMode, selectedIds.size, search, hasPrevMonthData,
      momDelta, prevMonthBucket, projectedRestOfYear, yearToDate, editingBudget, budgetDraft,
      budget, budgetDelta, budgetCents, daysLeft, period, selectedMonthIdx, selectedMonthStart, isEmptyList, isNoMatch,
      yearBuckets, currentMonthIdx, selectedCategory, byPayer, whoPaysCollapsed, memberProfiles,
      items, patchRow,
    ]
  );

  // "From your other sections" suggestion panel (HOUP-174), ported from
  // apps/web/src/app/costs/page.tsx. Hearth v2 (H2/H4): a neutral card, each
  // line led by the tile of the section it comes from, with neutral actions
  // (the screen's one primary action stays "Add"). Hoisted into
  // ListFooterComponent so it still scrolls with the list.
  const listFooter = React.useMemo(() => (
    !hideSectionSuggestions && (showRentSuggestion || showSetupSuggestion) && (
    <Card size="sm" className="mt-4 rounded-3xl">
      <View className="flex-row items-center justify-between gap-2 px-4">
        <Text className="text-micro-label uppercase text-muted-foreground">From your other sections</Text>
        <Pressable onPress={dismissSectionSuggestions} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss">
          <X size={16} className="text-muted-foreground" />
        </Pressable>
      </View>
      {showRentSuggestion && (
        <View className="flex-row items-center gap-3 px-4">
          <LeadingTile sectionId="search" Icon={sectionIconFor('search')} size="sm" />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>Rent</Text>
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(rentWeeklyCents)}/wk · chosen home
            </Text>
          </View>
          <Button size="sm" variant="outline" onPress={addRentLine}>
            Add as rent
          </Button>
        </View>
      )}
      {showSetupSuggestion && (
        <View className="flex-row items-center gap-3 px-4">
          <LeadingTile sectionId="setup" Icon={sectionIconFor('setup')} size="sm" />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>Home setup</Text>
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(setupTotalCents)} estimated
            </Text>
          </View>
          <Button size="sm" variant="outline" onPress={addSetupLine}>
            Add as one-off
          </Button>
        </View>
      )}
    </Card>
    )
  ), [hideSectionSuggestions, showRentSuggestion, showSetupSuggestion, rentWeeklyCents, setupTotalCents]);

  if (cacheLoading || (!storeLoaded && items.length === 0)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  const renderItem: ListRenderItem<CostListRow> = ({ item: row, index }) => {
    const prev = index > 0 ? flatData[index - 1] : undefined;
    const spacing =
      row.kind === 'quick-add'
        ? 'mt-2'
        : prev?.kind === 'quick-add'
          ? 'mt-4'
          : prev?.kind === 'row' || prev?.kind === 'group-header'
            ? rowSpacingClassName(prev, row)
            : undefined;
    if (row.kind === 'group-header') {
      // Header id is `group-header:${category}` (the key passed to flattenGroups).
      const cat = row.id.slice('group-header:'.length);
      const aggregateLabel = categoryAggregateLabel.get(cat);
      return (
        <Pressable
          onPress={() => toggleCatCollapsed(cat)}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsedCats.has(cat) }}
          className={cn('flex-row items-center gap-1.5 px-1 py-1', spacing)}
        >
          {collapsedCats.has(cat) ? (
            <ChevronRight size={14} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={14} className="text-muted-foreground" />
          )}
          <Text className={cn('text-[10.5px] font-medium uppercase tracking-[0.1em]', categoryTint(scheme, cat)?.title ?? 'text-muted-foreground')}>
            {row.label}
          </Text>
          <Text className="text-xs text-muted-foreground">{row.count}</Text>
          <View className="flex-1" />
          {aggregateLabel && (
            <Text className="text-xs font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {aggregateLabel}
            </Text>
          )}
        </Pressable>
      );
    }
    if (row.kind === 'quick-add') {
      return (
        <View className={spacing}>
          <CostQuickAdd onAdd={(name, dollars) => quickAdd(row.category, name, dollars)} />
        </View>
      );
    }
    return (
      <View className={cn(groupFrameClass(row.pos), spacing)}>
        <CostRow
          item={row.item}
          groupId={group.id}
          currentUserId={currentUserId}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          onEdit={(it) => {
            setEditingItem(it);
            setModalOpen(true);
          }}
          onDelete={handleDelete}
          onUpdate={(updated) => patchRow(updated.id, updated)}
          onAssign={handleAssign}
          estimateStepBack={row.item.is_estimate && !isOneOff(row.item) ? stepBack[row.item.category] : undefined}
          selectMode={selectMode}
          selected={selectedIds.has(row.item.id)}
          onToggleSelect={toggleSelect}
        />
      </View>
    );
  };

  return (
    <UpOverviewProvider api={upBankApi} enabled={modules.server('connectors.up-bank')} linking={modules.server('connectors.up-bank-links')}>
    <ScreenBackground>
      <FlashList
        ref={listRef}
        data={flatData}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter || undefined}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ disabled: false }}
        renderScrollComponent={KeyboardAwareScrollView}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 96,
        }}
      />

      {selectMode && selectedIds.size > 0 && (
        <View
          className="absolute inset-x-4 flex-row flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-popover px-3.5 py-2.5 shadow-lg"
          style={{ bottom: insets.bottom + 16 }}
        >
          <Text className="text-caption text-muted-foreground">{selectedIds.size} selected</Text>
          <Button size="sm" variant="outline" onPress={() => setBulkSheet('category')}>
            Category
          </Button>
          <Button size="sm" variant="outline" onPress={() => setBulkSheet('cadence')}>
            Frequency
          </Button>
          <Button size="sm" variant="outline" onPress={() => setBulkSheet('payer')}>
            Who pays
          </Button>
          {/* E4: destructive is danger text, never a fill. */}
          <Button size="sm" variant="outline" textClassName="text-destructive" onPress={bulkDelete}>
            Delete
          </Button>
        </View>
      )}

      <BottomSheet open={bulkSheet != null} onOpenChange={(open) => { if (!open) setBulkSheet(null); }} className="max-h-[70%] pb-3">
        <View className="gap-3 px-4 pb-2">
          <View className="border-b border-border pb-3">
            <Text className="font-heading text-title font-semibold text-foreground">Set {selectedIds.size} selected</Text>
          </View>

          {bulkSheet === 'category' && (
            <>
              <Text className="text-caption font-medium text-muted-foreground">Category</Text>
              <SearchablePicker
                options={CATEGORY_PICKER_OPTIONS}
                value={bulkCategory}
                onChange={(category) => setBulkCategory(category as CostCategory)}
                placeholder="Category..."
                searchPlaceholder="Search..."
                ariaLabel="Set category"
              />
              <Button onPress={() => bulkUpdate({ category: bulkCategory })}>Apply category</Button>
            </>
          )}

          {bulkSheet === 'cadence' && (
            <>
              <Text className="text-caption font-medium text-muted-foreground">Frequency</Text>
              <SegmentedControl
                options={CADENCE_SEGMENTS}
                value={bulkCadence}
                onChange={setBulkCadence}
                wrap
                size="sm"
                accessibilityLabel="Set frequency"
              />
              <Button
                onPress={() =>
                  bulkUpdate((item) => ({
                    cadence: bulkCadence,
                    end_date: bulkCadence === 'one_off' ? null : item.end_date,
                    discount_end_date: bulkCadence === 'one_off' ? null : item.discount_end_date,
                  }))
                }
              >
                Apply frequency
              </Button>
            </>
          )}

          {bulkSheet === 'payer' && (
            <ListGroup className="border-0 bg-transparent shadow-none">
              <ListItem onPress={() => bulkUpdate({ assigned_to: null })}>
                <ListItemLeading>
                  <MemberAvatar userId={null} profiles={memberProfiles} size={20} />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>Unassigned</ListItemTitle>
                </ListItemContent>
              </ListItem>
              {groupMembers.map((member) => (
                <ListItem key={member.user_id} onPress={() => bulkUpdate({ assigned_to: member.user_id })}>
                  <ListItemLeading>
                    <MemberAvatar userId={member.user_id} profiles={memberProfiles} size={20} />
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle>{memberLabel(member.user_id, memberProfiles)}</ListItemTitle>
                  </ListItemContent>
                </ListItem>
              ))}
            </ListGroup>
          )}
        </View>
      </BottomSheet>

      <CostModal
        key={editingItem?.id ?? `new-${addNonce}`}
        open={modalOpen}
        item={editingItem}
        groupId={group.id}
        currentUserId={currentUserId}
        onClose={() => {
          setModalOpen(false);
          setEditingItem(undefined);
        }}
        onSave={(saved) => {
          writeRow(saved);
          setModalOpen(false);
          setEditingItem(undefined);
        }}
      />
    </ScreenBackground>
    </UpOverviewProvider>
  );
}

function CostQuickAdd({ onAdd }: { onAdd: (name: string, dollars: string) => void }) {
  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, amount);
    setName('');
    setAmount('');
  };

  return (
    // A quiet inline row under its category's list, not another bordered box (H4).
    <View className="min-h-11 flex-row items-center gap-2 rounded-2xl bg-muted/30 px-4 py-1">
      <Plus size={14} className="shrink-0 text-muted-foreground" />
      <Input
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        placeholder="Add a cost..."
        className="h-8 flex-1 border-0 px-0"
      />
      <Input
        value={amount}
        onChangeText={setAmount}
        onSubmitEditing={submit}
        placeholder="Amount"
        accessibilityLabel="Amount"
        keyboardType="decimal-pad"
        className="h-8 w-20 border-0 px-0 text-right"
      />
      {!!name.trim() && (
        <Button size="sm" variant="ghost" onPress={submit}>
          Add
        </Button>
      )}
    </View>
  );
}
