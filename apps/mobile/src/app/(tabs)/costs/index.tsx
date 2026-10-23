// Costs (native). Since the Oct 22 redesign the screen is one page for a
// month (features/costs/costs-overview.tsx): spent out of the goal and what
// the month should end at, income, a chart of the months that picks the
// month for the whole page, and the categories opening into their shops,
// recurring costs and costs added by hand. Every figure comes from core
// costMonth, so Home, the digest and the assistant agree with it. With Up
// connected, "All payments" in the ⋯ menu shows every payment as a list
// (money-view.tsx). Web twin: apps/web/src/app/costs/page.tsx.
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { use$ } from '@legendapp/state/react';
import { ChevronLeft, X } from 'lucide-react-native';
import { Text, BottomSheet, Button, Card, Input, LeadingTile, ScreenBackground, haptics, toast } from '@homeup/ui';
import {
  apartments$,
  costItems$,
  costSectionSuggestions,
  formatMoney,
  setupItems$,
  todayISO,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  useModules,
  useUpConnected,
  useUpOverview,
  UpOverviewProvider,
  CostCategoriesProvider,
  createManualReminder,
  reminderKey,
  toISODate,
  type Apartment,
  type CostInsightMarks,
  type SubscriptionLine,
  type CostCategory,
  type CostItem,
  type SetupItem,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';
import { CostModal } from '@/features/costs/cost-modal';
import { CostsOverview } from '@/features/costs/costs-overview';
import { upBankApi } from '@/features/costs/up-bank-api';
import { MoneyView } from '@/features/costs/money-view';
import { sectionIconFor } from '@/lib/section-icons';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

// The bank overview wraps the whole screen so every figure can read the payments.
export default function CostsSectionScreen() {
  const modules = useModules();
  return (
    <UpOverviewProvider api={upBankApi} enabled={modules.server('connectors.up-bank')} linking={modules.server('connectors.up-bank-links')}
      sharing={modules.server('connectors.up-bank-sharing')}
    >
      <CostsScreenBody />
    </UpOverviewProvider>
  );
}

function CostsScreenBody() {
  const upConnected = useUpConnected();
  const { linking } = useUpOverview();
  const insets = useSafeAreaInsets();
  const { group, currentUserId, userSettings, memberProfiles, loading: cacheLoading } = useDataCache();

  const items$ = costItems$(group?.id);
  useReconnectSync(items$);
  const { writeRow, patchRow } = useStoreHelpers(items$, currentUserId);

  const items = use$(() =>
    Object.values(items$.get() ?? {})
      .filter((i): i is CostItem => !!i && !i.deleted)
      // Drop $0 grocery "actual" lines — leftovers from sessions started then undone.
      .filter((i) => !(i.category === 'grocery_estimate' && !i.is_estimate && (i.amount ?? 0) === 0))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  );
  const storeLoaded = useStoreLoaded(items$);

  // "From your other sections" data sources (HOUP-174).
  const modules = useModules();
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

  const [goal, setGoal] = React.useState<number | null>(null);
  const [editingGoal, setEditingGoal] = React.useState(false);
  const [goalDraft, setGoalDraft] = React.useState('');
  const [hideSectionSuggestions, setHideSectionSuggestions] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<CostItem | undefined>();
  const [newCategory, setNewCategory] = React.useState<CostCategory | undefined>();
  const [payments, setPayments] = React.useState(false);
  // Two "Add" opens in a row both key to 'new': this nonce remounts the form each time.
  const [addNonce, setAddNonce] = React.useState(0);

  // FLUX-65: the monthly goal (budget) syncs via user_settings. Hydrate once.
  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (cacheLoading || hydrated.current) return;
    hydrated.current = true;
    if (userSettings?.costs_budget_monthly != null) setGoal(userSettings.costs_budget_monthly);
    if (userSettings?.costs_hide_section_suggestions != null) setHideSectionSuggestions(userSettings.costs_hide_section_suggestions);
  }, [cacheLoading, userSettings]);

  const persistSettings = React.useCallback(async (payload: Record<string, unknown>) => {
    try {
      const supabase = getCurrentSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('user_settings').upsert({ user_id: user.id, updated_at: new Date().toISOString(), ...payload }, { onConflict: 'user_id' });
    } catch {
      // Offline, or the client isn't bound yet: the local state already shows it.
    }
  }, []);

  // Money insights: what this person hid and the subscriptions they kept
  // (user_settings.money_insight_marks). Older servers lack the column: the
  // marks then last until the screen closes.
  const insightsOn = modules.isEnabled('money-insights');
  const canSaveMarks = modules.server('costs.insight-marks');
  const [insightMarks, setInsightMarks] = React.useState<CostInsightMarks>({});
  React.useEffect(() => {
    if (userSettings?.money_insight_marks) setInsightMarks(userSettings.money_insight_marks);
  }, [userSettings?.money_insight_marks]);
  const updateMarks = React.useCallback(
    (update: (cur: CostInsightMarks) => CostInsightMarks) => {
      setInsightMarks((cur) => {
        const next = update(cur);
        if (canSaveMarks) void persistSettings({ money_insight_marks: next });
        return next;
      });
    },
    [canSaveMarks, persistSettings],
  );
  const remindToCancel = React.useCallback(
    async (sub: SubscriptionLine) => {
      if (!group?.id || !sub.item) return;
      const due = new Date();
      due.setDate(due.getDate() + 3);
      try {
        await createManualReminder(getCurrentSupabaseClient(), {
          groupId: group.id,
          templateKey: reminderKey('cost', sub.item.id, 'cancel'),
          title: `Cancel ${sub.name}?`,
          dueDate: toISODate(due),
          assignedTo: currentUserId ?? null,
          notes: 'From Worth a look on Costs.',
        });
        haptics.success();
        toast.success(`Reminder added for ${sub.name}`);
      } catch {
        toast.error("Couldn't add the reminder.");
      }
    },
    [group?.id, currentUserId],
  );

  const saveGoal = () => {
    const dollars = Number(goalDraft);
    const cents = goalDraft && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
    setGoal(cents);
    setEditingGoal(false);
    void persistSettings({ costs_budget_monthly: cents });
  };

  const dismissSectionSuggestions = () => {
    setHideSectionSuggestions(true);
    void persistSettings({ costs_hide_section_suggestions: true });
  };

  const openItem = (it: CostItem) => {
    setEditingItem(it);
    setModalOpen(true);
  };
  const openNew = (category?: CostCategory) => {
    setEditingItem(undefined);
    setNewCategory(category);
    setAddNonce((n) => n + 1);
    setModalOpen(true);
  };
  const archive = (item: CostItem, archived: boolean) => {
    haptics.remove();
    patchRow(item.id, { archived });
    if (archived) {
      toast.message(`Archived "${item.name}"`, {
        duration: 5000,
        action: { label: 'Undo', onPress: () => patchRow(item.id, { archived: false }) },
      });
    }
  };

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
    addLine({ name: 'Home setup', category: 'moving', amount: setupTotalCents, cadence: 'one_off', is_estimate: true, linked_section: 'home_setup' });
  };

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

  const suggestions = !hideSectionSuggestions && (showRentSuggestion || showSetupSuggestion) ? (
    <Card size="sm" className="rounded-3xl">
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
  ) : null;

  const nameOf = (uid: string) => memberLabel(uid, memberProfiles);

  return (
    <CostCategoriesProvider items={items}>
      <ScreenBackground>
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96, gap: 16 }}
        >
          {payments ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => setPayments(false)} className="min-h-10 flex-row items-center gap-1 self-start">
                <ChevronLeft size={16} className="text-foreground" />
                <Text className="text-sm font-medium text-foreground">Costs</Text>
              </Pressable>
              <MoneyView items={items} currentUserId={currentUserId ?? null} nameOf={nameOf} onOpenItem={openItem} onSetAmount={(item, cents) => patchRow(item.id, { amount: cents })} />
            </>
          ) : (
            <CostsOverview
              items={items}
              goalCents={goal}
              onEditGoal={() => {
                setGoalDraft(goal ? String(goal / 100) : '');
                setEditingGoal(true);
              }}
              onOpenItem={openItem}
              onAdd={openNew}
              onArchive={archive}
              onOpenPayments={upConnected && linking ? () => setPayments(true) : null}
              canArchive={modules.server('costs.redesign')}
              nameOf={nameOf}
              onSetAmount={(item, cents) => patchRow(item.id, { amount: cents })}
              footer={suggestions}
              insights={insightsOn ? { marks: insightMarks, onMarks: updateMarks, onRemind: modules.feature('insights.reminders') ? remindToCancel : null } : null}
            />
          )}
        </KeyboardAwareScrollView>

        <BottomSheet open={editingGoal} onOpenChange={setEditingGoal} className="pb-3">
          <View className="gap-3 px-4 pb-2">
            <Text className="font-heading text-title font-semibold text-foreground">Monthly goal</Text>
            <Text className="text-caption text-muted-foreground">What the household aims to spend in a month. Leave it empty for no goal.</Text>
            <Input autoFocus keyboardType="decimal-pad" value={goalDraft} onChangeText={setGoalDraft} placeholder="e.g. 9000" onSubmitEditing={saveGoal} />
            <Button onPress={saveGoal}>{goal && !goalDraft ? 'Remove the goal' : 'Save'}</Button>
          </View>
        </BottomSheet>

        <CostModal
          key={editingItem?.id ?? `new-${addNonce}`}
          open={modalOpen}
          item={editingItem}
          groupId={group.id}
          currentUserId={currentUserId}
          defaultCategory={newCategory}
          onArchive={modules.server('costs.redesign') ? archive : undefined}
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
    </CostCategoriesProvider>
  );
}
