// Hearth v2: the Budget and Bills Spaces, native twins of apps/web/src/app/
// home/money-spaces.tsx. Home is one dashboard, so these sit in Spaces with
// Groceries whether or not their shortcut is on. Tapping a shortcut filters
// Home down to its Space, shown `expanded` (every bar and row, not just the
// first few).
//
// Budget is the Costs hero in small (Guy, 2026-10-24): what is paid so far
// out of the goal, with the same status lines (core goalStatus: under goal so
// far, then where the month is heading), and the Costs glance card (Latest
// with recent spending, and Worth a look). Expanded adds the category bars
// from core home-lens.ts. Category hues key those bars only (a chart series,
// as on the Costs page); bill rows lead with the neutral category chip (H2).
// The fills are a static map for NativeWind's build-time class extraction,
// mirroring core CATEGORY_COLOR (see features/costs/cost-card.tsx).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Receipt, Wallet } from 'lucide-react-native';
import { Card, ProgressBar, Text } from '@homeup/ui';
import {
  SPACE_COLLAPSED_ROWS,
  buildBillsLens,
  buildBudgetLens,
  costItems$,
  daysUntilLabel,
  formatMoney,
  goalStatus,
  goalTone,
  monthLongName,
  readRecentSpendPrefs,
  saveUserSettings,
  useCurrentCostMonth,
  useInsightMarks,
  useModules,
  useMonthTotals,
  useStoreHelpers,
  type CostInsightMarks,
  type CostItem,
  type Group,
} from '@homeup/core';
import { CostModal } from '@/features/costs/cost-modal';
import { CATEGORY_BAR_FILL, CategoryChip } from '@/features/costs/cost-card';
import { CostsGlanceCard } from '@/features/costs/costs-glance';
import { GoalStatusLines } from '@/features/costs/goal-status';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { TileHeader } from './section-tiles';

const TONE_FILL = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', neutral: 'bg-foreground/45' } as const;

const tabular = { fontVariant: ['tabular-nums' as const] };

export function BudgetSpace({
  group,
  currentUserId,
  costItems,
  budgetCents,
  expanded,
  now,
}: {
  group: Group;
  currentUserId: string | null;
  costItems: CostItem[];
  budgetCents: number | null;
  expanded: boolean;
  now: Date;
}) {
  const router = useRouter();
  const modules = useModules();
  const { userSettings } = useDataCache();
  const { writeRow } = useStoreHelpers(costItems$(group.id), currentUserId);
  const [modalOpen, setModalOpen] = React.useState(false);
  const month = useCurrentCostMonth(costItems);
  const lens = buildBudgetLens(costItems, budgetCents, now, useMonthTotals(costItems));
  // Before the bank's payments are in (month null) no total shows: one without them jumps once they land.
  const status = month ? goalStatus(month, budgetCents, now) : [];
  const tone = month ? goalTone(month, budgetCents, now) : 'neutral';
  const discount = lens.endingDiscounts[0];
  const bars = expanded && month ? lens.categories : [];
  const openCosts = () => router.push('/costs');

  // Worth a look keeps the marks Costs keeps (user_settings.money_insight_marks).
  const insightsOn = modules.feature('hub.money-insights');
  const saveMarks = React.useCallback((marks: CostInsightMarks) => void saveUserSettings(getCurrentSupabaseClient(), { money_insight_marks: marks }), []);
  const [marks, onMarks] = useInsightMarks(userSettings?.money_insight_marks, modules.server('costs.insight-marks') ? saveMarks : null);

  return (
    <View>
      <Card size="sm">
        <View className="gap-4 px-4">
          <Pressable onPress={openCosts} accessibilityRole="button" accessibilityLabel="Budget, open Costs" className="gap-2">
            <TileHeader Icon={Wallet} sectionId="costs" title="Budget" />
            {month ? (
              <View className="flex-row items-baseline gap-2 pt-2">
                <Text className="text-title font-semibold text-foreground" style={tabular}>
                  {formatMoney(month.paidCents)}
                </Text>
                <Text className="text-caption text-muted-foreground" style={tabular}>
                  {budgetCents != null ? `of ${formatMoney(budgetCents)}` : `spent in ${monthLongName(month.month)}`}
                </Text>
              </View>
            ) : (
              <View className="mt-2 h-7 w-32 rounded-md bg-muted" accessibilityLabel="Reading your bank payments" />
            )}
            {!month ? null : budgetCents != null ? (
              // Solid: paid so far. Faint: what is still to come this month.
              <ProgressBar value={month.paidCents} expected={month.expectedCents} total={budgetCents} fillClassName={TONE_FILL[tone]} className="h-[3px]" />
            ) : (
              <Text className="text-caption text-muted-foreground">Set a monthly budget in Costs to track spend against it.</Text>
            )}
            <GoalStatusLines lines={status} />
            {discount && (
              <Text className="text-caption text-warning">
                {discount.label} discount ends {daysUntilLabel(discount.days)}.
              </Text>
            )}
          </Pressable>
          {bars.length > 0 && (
            <View className="gap-3" accessibilityLabel="By category">
              {bars.map((c) => (
                <View key={c.key} className="gap-1.5">
                  <View className="flex-row items-baseline justify-between gap-3">
                    <Text numberOfLines={1} className="min-w-0 shrink text-body text-foreground">
                      {c.label}
                    </Text>
                    <Text className="font-mono text-caption text-muted-foreground" style={tabular}>
                      {formatMoney(c.cents)}
                    </Text>
                  </View>
                  <ProgressBar value={c.cents} total={lens.spentCents} fillClassName={CATEGORY_BAR_FILL[c.key]} className="h-[3px]" />
                </View>
              ))}
            </View>
          )}
          <View className="-mx-4">
            <CostsGlanceCard
              bare
              items={costItems}
              goalCents={budgetCents}
              current
              recentPrefs={readRecentSpendPrefs(userSettings?.costs_recent_spend)}
              insights={insightsOn ? { marks, onMarks, onRemind: null } : null}
              onOpenPayments={openCosts}
              onOpenItem={openCosts}
              onOpenCategory={openCosts}
            />
          </View>
          <Pressable
            onPress={() => setModalOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add cost"
            hitSlop={6}
            className="min-h-9 flex-row items-center gap-1.5 self-start rounded-full bg-muted px-3.5"
          >
            <Plus size={14} className="text-foreground" />
            <Text className="text-xs font-medium text-foreground">Add cost</Text>
          </Pressable>
        </View>
      </Card>

      <CostModal
        key={modalOpen ? 'open' : 'closed'}
        open={modalOpen}
        groupId={group.id}
        currentUserId={currentUserId}
        onClose={() => setModalOpen(false)}
        onSave={(saved) => {
          writeRow(saved);
          setModalOpen(false);
        }}
      />
    </View>
  );
}

export function BillsSpace({ costItems, expanded, now }: { costItems: CostItem[]; expanded: boolean; now: Date }) {
  const router = useRouter();
  const lens = buildBillsLens(costItems, now);
  const rows = expanded ? lens.rows : lens.rows.slice(0, SPACE_COLLAPSED_ROWS);
  const byId = new Map(costItems.map((c) => [c.id, c]));
  const hidden = lens.rows.length - rows.length;

  return (
    <Pressable onPress={() => router.push('/costs')} accessibilityRole="button" accessibilityLabel="Bills">
      <Card size="sm">
        <View className="gap-3 px-4">
          <TileHeader
            Icon={Receipt}
            sectionId="costs"
            title="Bills"
            right={<Text className="text-caption text-muted-foreground">Next 30 days</Text>}
          />
          {lens.rows.length === 0 ? (
            <Text className="text-body text-muted-foreground">No bills due in the next 30 days.</Text>
          ) : (
            <>
              {lens.dueCount > 0 && (
                <View className="flex-row items-baseline gap-2">
                  <Text className="text-title font-semibold text-foreground" style={tabular}>
                    {formatMoney(lens.totalCents)}
                  </Text>
                  <Text className="text-caption text-muted-foreground" style={tabular}>
                    due across {lens.dueCount} {lens.dueCount === 1 ? 'bill' : 'bills'}
                  </Text>
                </View>
              )}
              <View>
                {rows.map((row, index) => {
                  const cost = byId.get(row.costId);
                  const when = row.discountEnding ? `Discount ends ${daysUntilLabel(row.days)}` : daysUntilLabel(row.days);
                  return (
                    <View key={row.key} className={`flex-row items-center gap-3 py-2.5 ${index > 0 ? 'border-t border-border' : ''}`}>
                      {cost && <CategoryChip category={cost.category} />}
                      <View className="min-w-0 flex-1 gap-0.5">
                        <Text numberOfLines={1} className="text-body font-medium text-foreground">
                          {row.name}
                        </Text>
                        <Text numberOfLines={1} className="text-caption text-muted-foreground">
                          <Text className={row.discountEnding ? 'text-caption text-warning' : 'text-caption text-muted-foreground'}>{when}</Text>
                          {row.provider ? ` · ${row.provider}` : ''}
                        </Text>
                      </View>
                      {row.cents != null && (
                        <Text className="font-mono text-body text-foreground" style={tabular}>
                          {formatMoney(row.cents)}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
              {hidden > 0 && (
                <Text className="text-caption text-muted-foreground" style={tabular}>
                  +{hidden} more
                </Text>
              )}
            </>
          )}
        </View>
      </Card>
    </Pressable>
  );
}
