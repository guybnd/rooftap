'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { use$ } from '@legendapp/state/react';
import { syncState } from '@legendapp/state';
import type { CostItem, CostCadence, CostCategory, Apartment } from '@homeup/core';
import { CATEGORY_COLOR, dialog } from '@homeup/core';
import {
  Plus,
  RotateCw,
  CheckSquare,
  ChevronDown,
  Trash2,
  X,
} from 'lucide-react';
import {
  type Period,
  PERIOD_LABEL,
  CATEGORY_META,
  CADENCE_LABEL,
  amountForPeriod,
  totalForPeriod,
  totalOneOff,
  isOneOff,
  formatMoney,
  monthlyAmount,
  monthlyProjection,
  stepBackByCategory,
  parseLocalDateOnly,
  costSectionSuggestions,
  useModules,
} from '@homeup/core';
import { deleteCostReminders, costItems$, setupItems$, apartments$, useReconnectSync, useStoreHelpers, useStoreLoaded } from '@homeup/core';
import { todayISO } from '@/app/tasks/moving-tasks';
import { CostCard } from './cost-card';
import { ListGroup } from '@/components/ui/list-item';
import { LeadingTile } from '@/components/ui/leading-tile';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { sectionIconFor } from '@/lib/section-icons';
import { CostModal } from './cost-modal';
import { CATEGORY_ICON } from './category-glyph';
import { SectionSearchBar } from '@/components/section-search-bar';
import { useFuzzySearch } from '@/hooks/use-fuzzy-search';
import { CostDashboard } from './cost-chart';
import { PopMenu, MenuItem, MenuLabel } from '../setup/pop-menu';
import { memberLabel, memberAvatar } from '../setup/member-label';
import { useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';

// FLUX-150 slice 2: Legend-State local-first migration

const PERIOD_KEY = 'costs_period';
const BUDGET_KEY = 'costs_budget_monthly';
const PERIODS: Period[] = ['weekly', 'monthly', 'yearly'];
const CADENCE_OPTIONS: CostCadence[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'one_off'];
const CATEGORY_OPTIONS = Object.keys(CATEGORY_META) as CostCategory[];

export default function CostsPage() {
  const { group, groupMembers, memberProfiles, currentUserId, userSettings, refresh: refreshCache, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: the rent suggestion needs costs and search, the setup one costs and
  // setup (module-features.ts). Off means its source store isn't read at all.
  const suggestRent = modules.feature('costs.suggest-rent');
  const suggestSetup = modules.feature('costs.suggest-setup');

  const apts$ = apartments$(suggestRent ? group?.id : undefined);
  useReconnectSync(apts$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );

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

  // Derive setup total from the setup items store (replaces the fetchSetupTotal Supabase call).
  const setupTotalCents = use$(() =>
    Object.values(setupItems$(suggestSetup ? group?.id : undefined).get() ?? {})
      .filter((i) => !!i && !i.deleted)
      .reduce((sum, i) => sum + (i.est_price ?? 0), 0) * 100
  );

  const [period, setPeriod] = useState<Period>('monthly');
  const [search, setSearch] = useState('');
  const wide = useWideLayout();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CostItem | undefined>();

  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [showWhoPays, setShowWhoPays] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // HOUP-277: the chart's month picker (below) drives the card list filter
  // directly — no separate toggle. `null` means "current month" (the chart's
  // own default); category tap-to-filter composes independently. Neither
  // narrows searchedItems itself, so the MoM tile / chart / breakdowns stay
  // accurate (see `visibleItems` below).
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CostCategory | null>(null);
  const [hideSectionSuggestions, setHideSectionSuggestions] = useState(false);

  // Monthly budget target (dollars) — local preference, no schema change.
  const [budget, setBudget] = useState<number | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState('');

  // FLUX-65: period + monthly budget now sync via user_settings. Hydrate once on
  // load — DB wins when present, else fall back to the legacy localStorage mirror.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (cacheLoading || hydratedRef.current) return;
    hydratedRef.current = true;

    const dbPeriod = userSettings?.costs_period;
    if (dbPeriod === 'weekly' || dbPeriod === 'monthly' || dbPeriod === 'yearly') {
      setPeriod(dbPeriod);
    } else {
      const saved = localStorage.getItem(PERIOD_KEY);
      if (saved === 'weekly' || saved === 'monthly' || saved === 'yearly') setPeriod(saved);
    }

    const dbBudgetCents = userSettings?.costs_budget_monthly;
    if (dbBudgetCents != null) {
      setBudget(dbBudgetCents / 100);
    } else {
      const b = localStorage.getItem(BUDGET_KEY);
      if (b && !Number.isNaN(Number(b))) setBudget(Number(b));
    }

    if (userSettings?.costs_hide_section_suggestions != null) setHideSectionSuggestions(userSettings.costs_hide_section_suggestions);
  }, [cacheLoading, userSettings]);

  const persistSettings = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...payload }, { onConflict: 'user_id' });
      refreshCache();
    } catch {
      /* offline / not signed in — localStorage mirror still holds the value */
    }
  }, [refreshCache]);

  const changePeriod = (p: Period) => {
    setPeriod(p);
    localStorage.setItem(PERIOD_KEY, p);
    persistSettings({ costs_period: p });
  };

  // Same toggle-off-on-repeat-click behavior the chart's bars had locally
  // before HOUP-277 lifted the selection up to the page.
  const selectMonth = (idx: number) => setSelectedMonthIdx((cur) => (cur === idx ? null : idx));

  const dismissSectionSuggestions = () => {
    setHideSectionSuggestions(true);
    persistSettings({ costs_hide_section_suggestions: true });
  };

  const saveBudget = (value: number | null) => {
    setBudget(value);
    if (value && value > 0) localStorage.setItem(BUDGET_KEY, String(value));
    else localStorage.removeItem(BUDGET_KEY);
    setEditingBudget(false);
    persistSettings({ costs_budget_monthly: value && value > 0 ? Math.round(value * 100) : null });
  };

  // Single-item delete: soft-delete in Legend (offline-safe) + fire-and-forget
  // reminder cleanup (reminders are nice-to-have; the cost delete is what matters).
  const handleRequestDelete = useCallback(
    (item: CostItem) => {
      softDeleteRow(item.id);
      const supabase = createClient();
      void deleteCostReminders(item, supabase);
    },
    [softDeleteRow]
  );

  // Bulk operations — Legend-State handles Supabase sync and offline retry.
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const bulkUpdate = (payload: Partial<CostItem>) => {
    if (selectedIds.size === 0) return;
    selectedIds.forEach((id) => patchRow(id, payload));
    exitSelectMode();
  };

  const bulkDelete = async () => {
    const targets = items.filter((i) => selectedIds.has(i.id));
    if (targets.length === 0) return;
    const confirmed = await dialog.confirm({
      title: `Delete ${targets.length} cost${targets.length === 1 ? '' : 's'}?`,
      message: 'This cannot be undone.',
      destructive: true,
    });
    if (!confirmed) return;
    const supabase = createClient();
    targets.forEach((it) => {
      softDeleteRow(it.id);
      void deleteCostReminders(it, supabase);
    });
    exitSelectMode();
  };

  // Chosen apartment's weekly rent (cents), if linked
  const chosenApt = apartments.find((a) => a.id === group?.chosen_apartment_id);
  const rentWeeklyCents = chosenApt?.rent_per_week ? Math.round(chosenApt.rent_per_week * 100) : 0;

  // Offline-safe: build the row and write it through the Legend store (same path
  // as quickAdd) instead of a direct Supabase insert + sync.
  const addLine = (line: Partial<CostItem> & Pick<CostItem, 'name' | 'category' | 'amount' | 'cadence'>) => {
    if (!group?.id) return;
    // Only a genuine one-off actual needs an occurrence date; recurring anchors
    // (e.g. rent) and estimate anchors (e.g. setup) legitimately have none.
    const isOneOffActual = line.cadence === 'one_off' && !(line.is_estimate ?? false);
    writeRow({
      id: crypto.randomUUID(),
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
      created_by: currentUserId ?? null,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      ...line,
    });
  };

  const addRentLine = () => {
    if (!rentWeeklyCents) return;
    addLine({
      name: 'Rent',
      category: 'rent',
      amount: rentWeeklyCents,
      cadence: 'weekly',
      linked_section: 'home_search',
    });
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

  // Quick-add is offline-safe — goes directly through the Legend store.
  const quickAdd = (category: CostCategory, name: string, dollars: string) => {
    if (!group?.id) return;
    writeRow({
      id: crypto.randomUUID(),
      group_id: group.id,
      name,
      category,
      amount: Math.round(parseFloat(dollars || '0') * 100),
      cadence: 'one_off',
      is_estimate: false,
      created_by: currentUserId ?? '',
      start_date: todayISO(),
      end_date: null,
      discount_end_date: null,
      provider: null,
      assigned_to: null,
      linked_section: null,
      notes: null,
      sort_order: 0,
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });
  };

  const toggleCatCollapsed = (cat: string) =>
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  // Fuzzy search narrows the list; totals, breakdown and the grouped cards below
  // all reflect the searched subset so empty categories drop out (FLUX-110).
  const searchedItems = useFuzzySearch(items, search, ['name', 'provider', 'notes']);

  if (cacheLoading || (!storeLoaded && items.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const recurring = searchedItems.filter((i) => !isOneOff(i));

  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  // FLUX-1563: an is_estimate recurring item is a forward projection, not a
  // backward one. Current month fills the remaining gap (max(est,act)); a
  // settled past month shows actuals only. One shared helper drives this
  // headline, the by-category panel below, and monthlyProjection (chart + MoM
  // tile) so all surfaces agree — see stepBackByCategory in @/lib/costs.
  const stepBack = stepBackByCategory(searchedItems, currentMonthStart, currentMonthStart);
  const stepBackMonthlyTotal = Object.values(stepBack).reduce((sum, r) => sum + r.effective, 0);

  // Always-monthly headline (the primary fix): non-estimate recurring costs
  // pass through unchanged; is_estimate categories step back per the shared
  // rule above instead of counting the full forecast regardless of spend.
  const monthlyTotal =
    recurring.filter((i) => !i.is_estimate).reduce((sum, i) => sum + monthlyAmount(i), 0) + stepBackMonthlyTotal;

  // Budget comparison (monthly basis)
  const budgetCents = budget ? budget * 100 : 0;
  const budgetDelta = budgetCents - monthlyTotal; // positive = under budget

  // vs-last-month: calendar month-over-month delta, independent of the period
  // toggle. monthlyProjection projects *forward* from `from`, so anchor at the
  // first of the previous month with a 2-month window: [prevMonth, currentMonth].
  // Correctness guard (plan review): monthlyProjection's one-off fallback dumps
  // any generic one-off with a missing/out-of-window start_date into bucket 0
  // (prevMonth) — pre-filter those out before projecting so they can't inflate
  // a false MoM delta. Recurring items and grocery items (estimate or actual)
  // pass through unfiltered; the function already window-guards grocery actuals.
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

  // Who-pays split for the selected period
  const byPayer = recurring.reduce((acc, i) => {
    const key = i.assigned_to ?? 'unassigned';
    acc[key] = (acc[key] ?? 0) + amountForPeriod(i, period);
    return acc;
  }, {} as Record<string, number>);

  // HOUP-277: the picked month (chart bars, defaulting to the real current
  // month) + category tap narrow ONLY the rendered card list — every
  // total/tile/panel above stays derived from the unfiltered
  // `recurring`/`searchedItems` so they can't silently re-scope (see the
  // "Critical derivation-graph fact" in the ticket plan). Recurring items are
  // always kept (they recur monthly); only dated one-offs are windowed to the
  // picked month. Undated one-offs are excluded, never fed through
  // parseLocalDateOnly(null).
  const selectedMonthStart =
    selectedMonthIdx !== null
      ? new Date(currentMonthStart.getFullYear(), selectedMonthIdx, 1)
      : currentMonthStart;
  const selectedMonthEnd = new Date(selectedMonthStart.getFullYear(), selectedMonthStart.getMonth() + 1, 0);
  const visibleItems = searchedItems.filter((i) => {
    if (isOneOff(i)) {
      if (!i.start_date) return false;
      const d = parseLocalDateOnly(i.start_date);
      if (d < selectedMonthStart || d > selectedMonthEnd) return false;
    }
    if (selectedCategory && i.category !== selectedCategory) return false;
    return true;
  });

  // Cost cards grouped by category (over the filtered subset)
  const grouped = visibleItems.reduce((acc, i) => {
    (acc[i.category] ??= []).push(i);
    return acc;
  }, {} as Record<string, CostItem[]>);

  return (
    <div className={cn('space-y-5 p-4 md:p-6 mx-auto pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-5xl')}>
      {/* Section head (Hearth v2 §11): the screen's actions on the right; the
          Hero lede below is the first thing on the ground. */}
      <div className="flex items-center justify-end gap-2">
        {items.length > 0 && (
          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className={`flex h-11 items-center gap-1.5 rounded-xl border px-3.5 text-sm transition-colors sm:h-10 ${
              selectMode
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'bg-muted border-border text-foreground hover:bg-accent'
            }`}
          >
            <CheckSquare className="h-4 w-4" />
            {selectMode ? 'Done' : 'Select'}
          </button>
        )}
        <button
          onClick={() => void syncState(items$).sync()}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent sm:h-10 sm:w-10"
          aria-label="Refresh"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setEditingItem(undefined);
            setIsModalOpen(true);
          }}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:h-10"
        >
          <Plus className="h-4 w-4" />
          Add cost
        </button>
      </div>

      {/* Hearth §13.7 "Desktop shell": on a wide screen the dashboard holds
          still on the left while the costs scroll on the right. */}
      <div className={wide ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-8' : 'space-y-5'}>
      <div className={cn('space-y-5', wide && 'sticky top-4')}>
      {items.length > 0 && (
        <CostDashboard
          items={searchedItems}
          currentMonthStart={currentMonthStart}
          monthlyTotal={monthlyTotal}
          budget={budget}
          budgetCents={budgetCents}
          budgetDelta={budgetDelta}
          momDelta={momDelta}
          hasPrevMonthData={hasPrevMonthData}
          prevMonthLabel={prevMonthBucket.label}
          editingBudget={editingBudget}
          budgetDraft={budgetDraft}
          onBudgetDraftChange={setBudgetDraft}
          onStartEditingBudget={(initialDraft) => {
            setBudgetDraft(initialDraft);
            setEditingBudget(true);
          }}
          onCancelEditingBudget={() => setEditingBudget(false)}
          onSaveBudget={saveBudget}
          selectedMonthIdx={selectedMonthIdx}
          onSelectMonth={selectMonth}
          selectedCategory={selectedCategory}
          onSelectCategory={(cat) => setSelectedCategory((prev) => (prev === cat ? null : cat))}
        />
      )}
      </div>

      <div className="space-y-5">
      {/* From your other sections — pull in rent & setup total */}
      {(() => {
        if (hideSectionSuggestions) return null;
        const { rent: showRent, setup: showSetup } = costSectionSuggestions({
          items,
          rentWeeklyCents,
          setupTotalCents,
          rentEnabled: suggestRent,
          setupEnabled: suggestSetup,
        });
        if (!showRent && !showSetup) return null;
        // Hearth v2 (H2/H4): a neutral card; each line leads with the tile of
        // the section it comes from, and its action is a neutral button (the
        // screen's one primary action stays "Add cost").
        const suggestionBtn =
          'flex h-9 flex-shrink-0 items-center rounded-xl border border-border bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent';
        return (
          <div className="rounded-3xl border border-border/60 bg-card px-4 py-3 shadow-[var(--card-shadow)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">From your other sections</h2>
              <button
                onClick={dismissSectionSuggestions}
                className="-mr-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="divide-y divide-border/60">
              {showRent && (
                <div className="flex items-center gap-3 py-2">
                  <LeadingTile sectionId="search" Icon={sectionIconFor('search')} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">Rent</div>
                    <div className="text-xs tabular-nums text-muted-foreground">{formatMoney(rentWeeklyCents)}/wk · chosen home</div>
                  </div>
                  <button onClick={addRentLine} className={suggestionBtn}>
                    Add as rent
                  </button>
                </div>
              )}
              {showSetup && (
                <div className="flex items-center gap-3 py-2">
                  <LeadingTile sectionId="setup" Icon={sectionIconFor('setup')} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">Home setup</div>
                    <div className="text-xs tabular-nums text-muted-foreground">{formatMoney(setupTotalCents)} estimated</div>
                  </div>
                  <button onClick={addSetupLine} className={suggestionBtn}>
                    Add as one-off
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* The list's controls sit above what they act on (H5): search, then the
          period the totals below are shown in (Who pays + category totals). */}
      {items.length > 0 && (
        <div className="space-y-3">
          <SectionSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search costs…"
            className="max-w-none"
          />
          <SegmentedControl
            ariaLabel="Show totals"
            value={period}
            onChange={changePeriod}
            options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
            className="sm:max-w-xs"
          />
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-3xl border border-border/60 bg-card px-6 py-10 text-center shadow-[var(--card-shadow)]">
          <p className="text-sm text-muted-foreground">No costs yet. Add your rent, utilities, internet and more.</p>
        </div>
      ) : searchedItems.length === 0 ? (
        <div className="rounded-3xl border border-border/60 bg-card px-6 py-10 text-center shadow-[var(--card-shadow)]">
          <p className="text-sm text-muted-foreground">No costs match your search.</p>
        </div>
      ) : (
        <>
          {/* Who pays — demoted: compact, collapsed by default */}
          {Object.keys(byPayer).length > 0 && (
            <div className="rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
              <button
                onClick={() => setShowWhoPays((v) => !v)}
                aria-expanded={showWhoPays}
                className="w-full flex min-h-11 items-center gap-2 px-4 py-2.5 text-left"
              >
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showWhoPays ? '' : '-rotate-90'}`} />
                <span className="text-sm font-medium text-foreground">Who pays</span>
              </button>
              {showWhoPays && (
                <div className="px-4 pb-3 space-y-2">
                  {Object.entries(byPayer)
                    .sort((a, b) => b[1] - a[1])
                    .map(([payer, amt]) => {
                      const uid = payer === 'unassigned' ? null : payer;
                      const avatar = uid ? memberAvatar(uid, memberProfiles) : null;
                      const name = memberLabel(uid, memberProfiles);
                      return (
                        <div key={payer} className="flex items-center gap-2 text-sm">
                          {avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatar} alt="" className="h-5 w-5 rounded-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase">
                              {name.charAt(0)}
                            </span>
                          )}
                          <span className="flex-1 text-foreground truncate">{name}</span>
                          <span className="tabular-nums text-muted-foreground">{formatMoney(amt)}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* Cost list grouped by category (collapsible + rollups). Group header
              (Hearth §6 tenant matrix): chevron + micro label + count on the
              left, tabular aggregate on the right, colored only when semantic.
              No per-category budget exists, so both the recurring and the
              one-off totals stay neutral (H2: a one-off is not a state).
              ListGroup alone supplies the row list's single bordered card (H4). */}
          {Object.keys(grouped).length === 0 ? (
            <div className="rounded-3xl border border-border/60 bg-card px-6 py-8 text-center shadow-[var(--card-shadow)]">
              <p className="text-sm text-muted-foreground">
                No costs {selectedCategory ? 'match this filter' : `in ${selectedMonthStart.toLocaleString('default', { month: 'long' })}`}.
              </p>
            </div>
          ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([cat, catItems]) => {
              const collapsed = collapsedCats.has(cat);
              const recItems = catItems.filter((i) => !isOneOff(i));
              const catPeriod = totalForPeriod(recItems, period);
              const catOnce = totalOneOff(catItems);
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleCatCollapsed(cat)}
                    aria-expanded={!collapsed}
                    className="w-full flex min-h-11 items-center gap-3 py-1.5 text-left"
                  >
                    <ChevronDown className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                    <span className="flex items-baseline gap-1.5 flex-shrink-0 min-w-0">
                      <span className={cn('text-[10.5px] font-semibold uppercase tracking-[0.1em] truncate', CATEGORY_COLOR[cat as CostCategory].text)}>
                        {CATEGORY_META[cat as CostCategory].label}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{catItems.length}</span>
                    </span>
                    <span className="ml-auto text-xs tabular-nums flex-shrink-0">
                      {catPeriod > 0 && <span className="font-medium text-foreground">{formatMoney(catPeriod)}</span>}
                      {catPeriod > 0 && catOnce > 0 && <span className="text-muted-foreground"> · </span>}
                      {catOnce > 0 && <span className="text-muted-foreground">{formatMoney(catOnce)} once</span>}
                    </span>
                  </button>

                  {!collapsed && (
                    <div className="space-y-2">
                      <ListGroup>
                        {catItems.map((item) => (
                          <CostCard
                            key={item.id}
                            item={item}
                            groupId={group.id}
                            groupMembers={groupMembers}
                            memberProfiles={memberProfiles}
                            selected={selectedIds.has(item.id)}
                            estimateStepBack={item.is_estimate && !isOneOff(item) ? stepBack[item.category] : undefined}
                            leading={
                              selectMode ? (
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(item.id)}
                                  onChange={() => toggleSelect(item.id)}
                                  className="h-4 w-4 rounded accent-primary flex-shrink-0 cursor-pointer"
                                  aria-label="Select cost"
                                />
                              ) : undefined
                            }
                            onUpdate={(u) => patchRow(u.id, u)}
                            onRequestDelete={handleRequestDelete}
                            onEdit={(it) => {
                              setEditingItem(it);
                              setIsModalOpen(true);
                            }}
                          />
                        ))}
                      </ListGroup>
                      {!selectMode && (
                        <CostQuickAdd onAdd={(name, dollars) => quickAdd(cat as CostCategory, name, dollars)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </>
      )}
      </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-xl shadow-black/40 max-w-[calc(100vw-2rem)] flex-wrap justify-center">
          <span className="text-sm text-foreground px-1">{selectedIds.size} selected</span>

          <PopMenu
            align="left"
            width="w-44"
            triggerLabel="Set category"
            triggerClassName="flex items-center gap-1 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            trigger={<>Category <ChevronDown className="h-3.5 w-3.5" /></>}
          >
            {(close) => (
              <>
                <MenuLabel>Set category</MenuLabel>
                {CATEGORY_OPTIONS.map((c) => (
                  <MenuItem
                    key={c}
                    icon={(() => {
                      const Icon = CATEGORY_ICON[c];
                      return <Icon className="h-3.5 w-3.5" />;
                    })()}
                    onClick={() => {
                      bulkUpdate({ category: c });
                      close();
                    }}
                  >
                    {CATEGORY_META[c].label}
                  </MenuItem>
                ))}
              </>
            )}
          </PopMenu>

          <PopMenu
            align="left"
            width="w-40"
            triggerLabel="Set frequency"
            triggerClassName="flex items-center gap-1 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            trigger={<>Frequency <ChevronDown className="h-3.5 w-3.5" /></>}
          >
            {(close) => (
              <>
                <MenuLabel>Set frequency</MenuLabel>
                {CADENCE_OPTIONS.map((c) => (
                  <MenuItem
                    key={c}
                    onClick={() => {
                      bulkUpdate({ cadence: c });
                      close();
                    }}
                  >
                    {CADENCE_LABEL[c]}
                  </MenuItem>
                ))}
              </>
            )}
          </PopMenu>

          <PopMenu
            align="left"
            width="w-44"
            triggerLabel="Set who pays"
            triggerClassName="flex items-center gap-1 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            trigger={<>Who pays <ChevronDown className="h-3.5 w-3.5" /></>}
          >
            {(close) => (
              <>
                <MenuLabel>Who pays</MenuLabel>
                <MenuItem
                  onClick={() => {
                    bulkUpdate({ assigned_to: null });
                    close();
                  }}
                >
                  Unassigned
                </MenuItem>
                {groupMembers.map((m) => (
                  <MenuItem
                    key={m.user_id}
                    onClick={() => {
                      bulkUpdate({ assigned_to: m.user_id });
                      close();
                    }}
                  >
                    {memberLabel(m.user_id, memberProfiles)}
                  </MenuItem>
                ))}
              </>
            )}
          </PopMenu>

          <button
            onClick={bulkDelete}
            className="flex items-center gap-1 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-accent"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>

          <button
            onClick={() => setSelectedIds(new Set())}
            className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <CostModal
        key={editingItem?.id ?? 'new'}
        isOpen={isModalOpen}
        item={editingItem}
        groupId={group.id}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(undefined);
        }}
        onSave={(saved) => {
          // CostModal builds the row; write it through the Legend store
          // (offline-safe — classifies insert vs update and stamps created_by).
          writeRow(saved);
          setIsModalOpen(false);
          setEditingItem(undefined);
        }}
        onDelete={(id) => {
          const target = items.find((i) => i.id === id);
          if (target) handleRequestDelete(target);
          setIsModalOpen(false);
          setEditingItem(undefined);
        }}
      />
    </div>
  );
}

// Inline quick-add for a category: name + amount, saved as a one-off dated today.
function CostQuickAdd({ onAdd }: { onAdd: (name: string, dollars: string) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  const submit = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), amount);
    setName('');
    setAmount('');
  };

  return (
    // A quiet inline row under its category's list, not another bordered
    // box (H4); it fills in when focused.
    <div className="flex min-h-11 items-center gap-2 rounded-2xl px-4 py-1.5 transition-colors hover:bg-muted/40 focus-within:bg-muted/50">
      <Plus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Add a cost…"
        className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
      />
      <input
        type="number"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Amount"
        aria-label="Amount"
        className="w-20 bg-transparent text-sm text-foreground placeholder-muted-foreground text-right focus:outline-none"
      />
      {name.trim() && (
        <button
          onClick={submit}
          className="text-xs font-medium text-primary hover:text-primary/80 flex-shrink-0"
        >
          Add
        </button>
      )}
    </div>
  );
}
