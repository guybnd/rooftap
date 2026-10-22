// Hearth v2: the Budget and Bills Spaces, native twins of apps/web/src/app/
// home/money-spaces.tsx. Home is one dashboard, so these sit in Spaces with
// Groceries whether or not their shortcut is on. Tapping a shortcut filters
// Home down to its Space, shown `expanded` (every bar and row, not just the
// first few). The numbers come from core home-lens.ts.
//
// Category hues key the budget's bars only (a chart series, as on the Costs
// page); bill rows lead with the neutral category chip (H2). The fills are a
// static map for NativeWind's build-time class extraction, mirroring core
// CATEGORY_COLOR (see features/costs/cost-dashboard.tsx).
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
  useStoreHelpers,
  type CostCategory,
  type CostItem,
  type Group,
} from '@homeup/core';
import { CostModal } from '@/features/costs/cost-modal';
import { CategoryChip } from '@/features/costs/cost-card';
import { deriveBudgetPulseTone } from './budget-tile';
import { TileHeader } from './section-tiles';

const CATEGORY_BAR_FILL: Record<CostCategory | 'rest', string> = {
  rent: 'bg-blue-300',
  utilities: 'bg-amber-200',
  internet: 'bg-cyan-300',
  insurance: 'bg-violet-300',
  subscription: 'bg-pink-300',
  grocery_estimate: 'bg-lime-200',
  moving: 'bg-orange-300',
  purchase: 'bg-fuchsia-300',
  outing: 'bg-sky-200',
  transport: 'bg-indigo-300',
  health: 'bg-teal-300',
  pets: 'bg-emerald-200',
  family: 'bg-rose-200',
  other: 'bg-slate-400',
  rest: 'bg-foreground/45',
};

const TONE_FILL = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive' } as const;

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
  const { writeRow } = useStoreHelpers(costItems$(group.id), currentUserId);
  const [modalOpen, setModalOpen] = React.useState(false);
  const lens = buildBudgetLens(costItems, budgetCents, now);
  const over = lens.leftCents != null && lens.leftCents < 0;
  const discount = lens.endingDiscounts[0];
  const tone = lens.budgetCents != null ? deriveBudgetPulseTone(lens.budgetCents, lens.spentCents) : 'success';
  const bars = expanded ? lens.categories : lens.categories.slice(0, SPACE_COLLAPSED_ROWS);

  return (
    <View>
      <Pressable onPress={() => router.push('/costs')} accessibilityRole="button" accessibilityLabel="Budget">
        <Card size="sm">
          <View className="gap-4 px-4">
            <TileHeader Icon={Wallet} sectionId="costs" title="Budget" />
            <View className="gap-2">
              {lens.budgetCents != null && lens.leftCents != null ? (
                <View className="flex-row items-baseline gap-2">
                  <Text className={`text-title font-semibold ${over ? 'text-destructive' : 'text-foreground'}`} style={tabular}>
                    {formatMoney(Math.abs(lens.leftCents))}
                  </Text>
                  <Text className="text-caption text-muted-foreground" style={tabular}>
                    {over ? 'over' : 'left of'} {formatMoney(lens.budgetCents)}
                  </Text>
                </View>
              ) : (
                <View className="flex-row items-baseline gap-2">
                  <Text className="text-title font-semibold text-foreground" style={tabular}>
                    {formatMoney(lens.spentCents)}
                  </Text>
                  <Text className="text-caption text-muted-foreground">/ month</Text>
                </View>
              )}
              {lens.budgetCents != null ? (
                <ProgressBar value={lens.spentCents} total={lens.budgetCents} fillClassName={TONE_FILL[tone]} className="h-[3px]" />
              ) : (
                <Text className="text-caption text-muted-foreground">Set a monthly budget in Costs to track spend against it.</Text>
              )}
              {(lens.committedPct != null || discount) && (
                <Text className="text-caption text-muted-foreground" style={tabular}>
                  {lens.committedPct != null ? `${lens.committedPct}% committed. ` : ''}
                  {discount && (
                    <Text className="text-caption text-warning">
                      {discount.label} discount ends {daysUntilLabel(discount.days)}.
                    </Text>
                  )}
                </Text>
              )}
            </View>
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
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                setModalOpen(true);
              }}
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
      </Pressable>

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
