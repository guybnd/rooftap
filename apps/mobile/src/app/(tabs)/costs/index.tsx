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
import { Text, Button, Card, LeadingTile, ScreenBackground, haptics, toast } from '@homeup/ui';
import {
  apartments$,
  costItems$,
  costSectionSuggestions,
  formatMoney,
  setupItems$,
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
  type UserSettings,
  readRecentSpendPrefs,
  saveUserSettings,
  type SubscriptionLine,
  type CostCategory,
  type CostItem,
  type SetupItem,
  newCostLine,
  rentCostLine,
  setupCostLine,
  type NewCostLine,
  useInsightMarks,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { randomUUID } from '@/lib/uuid';
import { CostModal } from '@/features/costs/cost-modal';
import { CostsOverview } from '@/features/costs/costs-overview';
import { upBankApi } from '@/features/costs/up-bank-api';
import { MoneyView } from '@/features/costs/money-view';
import { useModuleSettingsSheet } from '@/features/settings/module-settings-sheet';
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

  // The monthly goal in cents, set in Costs settings (module-settings.ts).
  const goal = userSettings?.costs_budget_monthly ?? null;
  const settings = useModuleSettingsSheet('costs');
  const [hideSectionSuggestions, setHideSectionSuggestions] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<CostItem | undefined>();
  const [newCategory, setNewCategory] = React.useState<CostCategory | undefined>();
  const [payments, setPayments] = React.useState(false);
  // Two "Add" opens in a row both key to 'new': this nonce remounts the form each time.
  const [addNonce, setAddNonce] = React.useState(0);

  // Hydrate once.
  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (cacheLoading || hydrated.current) return;
    hydrated.current = true;
    if (userSettings?.costs_hide_section_suggestions != null) setHideSectionSuggestions(userSettings.costs_hide_section_suggestions);
  }, [cacheLoading, userSettings]);

  const persistSettings = React.useCallback(async (payload: Partial<UserSettings>) => {
    await saveUserSettings(getCurrentSupabaseClient(), payload);
  }, []);

  // Money insights: what this person hid and the subscriptions they kept
  // (user_settings.money_insight_marks). Older servers lack the column: the
  // marks then last until the screen closes.
  const insightsOn = modules.isEnabled('money-insights');
  const canSaveMarks = modules.server('costs.insight-marks');
  const saveMarks = React.useCallback((marks: CostInsightMarks) => void persistSettings({ money_insight_marks: marks }), [persistSettings]);
  const [insightMarks, updateMarks] = useInsightMarks(userSettings?.money_insight_marks, canSaveMarks ? saveMarks : null);
  // Assistant summaries (money-summary.ts) and recent spending (recent-spend.ts) are set in Costs settings.
  const canSummarise = insightsOn && modules.isEnabled('assistant');
  const recentPrefs = readRecentSpendPrefs(userSettings?.costs_recent_spend);
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

  const addLine = (line: NewCostLine) => {
    if (!group?.id) return;
    writeRow(newCostLine(line, { id: randomUUID(), groupId: group.id, createdBy: currentUserId }));
  };

  const addRentLine = () => {
    if (!rentWeeklyCents) return;
    addLine(rentCostLine(rentWeeklyCents));
  };

  const addSetupLine = () => {
    if (!setupTotalCents) return;
    addLine(setupCostLine(setupTotalCents));
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
              onOpenSettings={settings.available ? settings : null}
              onOpenItem={openItem}
              onAdd={openNew}
              onArchive={archive}
              onOpenPayments={upConnected && linking ? () => setPayments(true) : null}
              canArchive={modules.server('costs.redesign')}
              nameOf={nameOf}
              onSetAmount={(item, cents) => patchRow(item.id, { amount: cents })}
              onPatchItem={(item, patch) => patchRow(item.id, patch)}
              footer={suggestions}
              recentPrefs={recentPrefs}
              canSummarise={canSummarise}
              insights={insightsOn ? { marks: insightMarks, onMarks: updateMarks, onRemind: modules.feature('insights.reminders') ? remindToCancel : null } : null}
            />
          )}
        </KeyboardAwareScrollView>

        {settings.sheet}

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
