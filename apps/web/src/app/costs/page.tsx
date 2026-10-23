'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDataCache } from '@/lib/data-cache';
import { createClient } from '@/lib/supabase/client';
import { use$ } from '@legendapp/state/react';
import type { CostItem, CostCategory, Apartment, CostInsightMarks, MoneySummaryPrefs, SubscriptionLine } from '@homeup/core';
import { toast } from 'sonner';
import { ArrowLeft, X } from 'lucide-react';
import {
  formatMoney,
  costSectionSuggestions,
  CostCategoriesProvider,
  UpOverviewProvider,
  useModules,
  createManualReminder,
  reminderKey,
  toISODate,
} from '@homeup/core';
import { deleteCostReminders, costItems$, setupItems$, apartments$, useReconnectSync, useStoreHelpers, useStoreLoaded } from '@homeup/core';
import { todayISO } from '@/app/tasks/moving-tasks';
import { LeadingTile } from '@/components/ui/leading-tile';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Input } from '@/components/ui/input';
import { sectionIconFor } from '@/lib/section-icons';
import { toastUndoAction } from '@/lib/undo-toast';
import { CostModal } from './cost-modal';
import { CostsOverview } from './costs-overview';
import { memberLabel } from '../setup/member-label';
import { MoneyView } from './money-view';
import { upBankApi } from '@/lib/up-bank-client';
import { useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';

// Costs (Guy's redesign, Oct 22): the page is CostsOverview, one month at a
// time from core costMonth. This file keeps the data around it: the cost
// lines store, the monthly goal, the rent and setup suggestions, the cost
// sheet, and "All payments" (the raw bank list, behind the ⋯ menu).

const BUDGET_KEY = 'costs_budget_monthly';

export default function CostsPage() {
  const { group, memberProfiles, currentUserId, userSettings, refresh: refreshCache, loading: cacheLoading } = useDataCache();
  const modules = useModules();
  // Modules: the rent suggestion needs costs and search, the setup one costs and
  // setup (module-features.ts). Off means its source store isn't read at all.
  const suggestRent = modules.feature('costs.suggest-rent');
  const suggestSetup = modules.feature('costs.suggest-setup');
  const upBank = modules.server('connectors.up-bank');
  const upLinks = modules.server('connectors.up-bank-links');
  const redesign = modules.server('costs.redesign');

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

  const wide = useWideLayout();
  const [payments, setPayments] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CostItem | undefined>();
  const [newCategory, setNewCategory] = useState<CostCategory | undefined>();
  const [hideSectionSuggestions, setHideSectionSuggestions] = useState(false);

  // The monthly goal in cents, synced via user_settings (FLUX-65).
  const [goalCents, setGoalCents] = useState<number | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');

  // Hydrate once on load: DB wins when present, else the legacy localStorage
  // mirror (dollars).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (cacheLoading || hydratedRef.current) return;
    hydratedRef.current = true;

    const dbBudgetCents = userSettings?.costs_budget_monthly;
    if (dbBudgetCents != null) {
      setGoalCents(dbBudgetCents);
    } else {
      const b = localStorage.getItem(BUDGET_KEY);
      if (b && !Number.isNaN(Number(b))) setGoalCents(Math.round(Number(b) * 100));
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

  const dismissSectionSuggestions = () => {
    setHideSectionSuggestions(true);
    persistSettings({ costs_hide_section_suggestions: true });
  };

  // Money insights: what this person hid and the subscriptions they kept
  // (user_settings.money_insight_marks). Older servers lack the column: the
  // marks then last until the page closes.
  const insightsOn = modules.isEnabled('money-insights');
  const canSaveMarks = modules.server('costs.insight-marks');
  const [insightMarks, setInsightMarks] = useState<CostInsightMarks>({});
  useEffect(() => {
    if (userSettings?.money_insight_marks) setInsightMarks(userSettings.money_insight_marks);
  }, [userSettings?.money_insight_marks]);
  const updateMarks = useCallback(
    (update: (cur: CostInsightMarks) => CostInsightMarks) => {
      setInsightMarks((cur) => {
        const next = update(cur);
        if (canSaveMarks) void persistSettings({ money_insight_marks: next });
        return next;
      });
    },
    [canSaveMarks, persistSettings],
  );
  // Assistant summaries (money-summary.ts): asked for per person, posted to the Household chat.
  const summariesOn = insightsOn && modules.isEnabled('assistant');
  const [summaryPrefs, setSummaryPrefs] = useState<MoneySummaryPrefs>({});
  useEffect(() => {
    if (userSettings?.money_summaries) setSummaryPrefs(userSettings.money_summaries);
  }, [userSettings?.money_summaries]);
  const saveSummaryPrefs = useCallback(
    (next: MoneySummaryPrefs) => {
      setSummaryPrefs(next);
      void persistSettings({ money_summaries: next });
    },
    [persistSettings],
  );
  const remindToCancel = useCallback(
    async (sub: SubscriptionLine) => {
      if (!group?.id || !sub.item) return;
      const due = new Date();
      due.setDate(due.getDate() + 3);
      await createManualReminder(createClient(), {
        groupId: group.id,
        templateKey: reminderKey('cost', sub.item.id, 'cancel'),
        title: `Cancel ${sub.name}?`,
        dueDate: toISODate(due),
        assignedTo: currentUserId ?? null,
        notes: 'From Worth a look on Costs.',
      });
      toast.success(`Reminder added for ${sub.name}`);
    },
    [group?.id, currentUserId],
  );

  const saveGoal = (cents: number | null) => {
    const value = cents && cents > 0 ? cents : null;
    setGoalCents(value);
    if (value) localStorage.setItem(BUDGET_KEY, String(value / 100));
    else localStorage.removeItem(BUDGET_KEY);
    setEditingGoal(false);
    persistSettings({ costs_budget_monthly: value });
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

  const openItem = (item: CostItem) => {
    setEditingItem(item);
    setNewCategory(undefined);
    setIsModalOpen(true);
  };
  const openNew = (category?: CostCategory) => {
    setEditingItem(undefined);
    setNewCategory(category);
    setIsModalOpen(true);
  };
  const closeModal = () => {
    setIsModalOpen(false);
    setEditingItem(undefined);
  };
  // Archived costs stay so bank payments still find them, but leave every total.
  const archive = (item: CostItem, archived: boolean) => {
    patchRow(item.id, { archived });
    if (archived) toastUndoAction(`Archived "${item.name}"`, () => patchRow(item.id, { archived: false }));
  };

  // Chosen apartment's weekly rent (cents), if linked
  const chosenApt = apartments.find((a) => a.id === group?.chosen_apartment_id);
  const rentWeeklyCents = chosenApt?.rent_per_week ? Math.round(chosenApt.rent_per_week * 100) : 0;

  // Offline-safe: build the row and write it through the Legend store.
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
    addLine({ name: 'Rent', category: 'rent', amount: rentWeeklyCents, cadence: 'weekly', linked_section: 'home_search' });
  };

  const addSetupLine = () => {
    if (!setupTotalCents) return;
    addLine({ name: 'Home setup', category: 'moving', amount: setupTotalCents, cadence: 'one_off', is_estimate: true, linked_section: 'home_setup' });
  };

  if (cacheLoading || (!storeLoaded && items.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const nameOf = (uid: string) => memberLabel(uid, memberProfiles);
  const setAmount = (item: CostItem, cents: number) => patchRow(item.id, { amount: cents });

  // From your other sections: pull in rent and the setup total.
  const suggestions = (() => {
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
  })();

  return (
    <UpOverviewProvider api={upBankApi} enabled={upBank} linking={upLinks} sharing={modules.server('connectors.up-bank-sharing')}>
    <CostCategoriesProvider items={items}>
    <div className={cn('mx-auto space-y-5 p-4 pb-24 md:p-6', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-5xl')}>
      {payments ? (
        <>
          <button
            type="button"
            onClick={() => setPayments(false)}
            className="flex h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Costs
          </button>
          <MoneyView items={items} currentUserId={currentUserId} nameOf={nameOf} onOpenItem={openItem} onSetAmount={setAmount} />
        </>
      ) : (
        <CostsOverview
          items={items}
          goalCents={goalCents}
          onEditGoal={() => {
            setGoalDraft(goalCents ? String(goalCents / 100) : '');
            setEditingGoal(true);
          }}
          onOpenItem={openItem}
          onAdd={openNew}
          onArchive={archive}
          onOpenPayments={upBank ? () => setPayments(true) : null}
          canArchive={redesign}
          nameOf={nameOf}
          onSetAmount={setAmount}
          onPatchItem={(item, patch) => patchRow(item.id, patch)}
          footer={suggestions}
          wide={wide}
          summaries={summariesOn ? { prefs: summaryPrefs, onChange: modules.server('costs.money-summaries') ? saveSummaryPrefs : null } : null}
          insights={insightsOn ? { marks: insightMarks, onMarks: updateMarks, onRemind: modules.feature('insights.reminders') ? remindToCancel : null } : null}
        />
      )}

      <BottomSheet
        open={editingGoal}
        onOpenChange={setEditingGoal}
        overlayClassName="bg-black/40"
        className="rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4"
        handleClassName="sm:hidden"
        popupProps={{ 'aria-label': 'Monthly goal' }}
      >
        <form
          className="space-y-3 pb-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            const dollars = parseFloat(goalDraft);
            saveGoal(Number.isFinite(dollars) ? Math.round(dollars * 100) : null);
          }}
        >
          <p className="text-lg font-semibold text-foreground">Monthly goal</p>
          <p className="text-sm text-muted-foreground">What the household aims to spend in a month. Leave it empty to have no goal.</p>
          <Input type="number" inputMode="decimal" step="1" min="0" autoFocus value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)} placeholder="4000" aria-label="Monthly goal in dollars" />
          <div className="flex justify-end gap-2">
            {goalCents ? (
              <button type="button" onClick={() => saveGoal(null)} className="h-10 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted">
                Remove goal
              </button>
            ) : null}
            <button type="submit" className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Save
            </button>
          </div>
        </form>
      </BottomSheet>

      <CostModal
        key={editingItem?.id ?? `new-${newCategory ?? ''}`}
        isOpen={isModalOpen}
        item={editingItem}
        groupId={group.id}
        defaultCategory={newCategory}
        onClose={closeModal}
        onSave={(saved) => {
          // CostModal builds the row; write it through the Legend store
          // (offline-safe — classifies insert vs update and stamps created_by).
          writeRow(saved);
          closeModal();
        }}
        onDelete={(id) => {
          const target = items.find((i) => i.id === id);
          if (target) handleRequestDelete(target);
          closeModal();
        }}
        onArchive={redesign ? (item, archived) => { archive(item, archived); closeModal(); } : undefined}
      />
    </div>
    </CostCategoriesProvider>
    </UpOverviewProvider>
  );
}
