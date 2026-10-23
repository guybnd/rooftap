// A Costs row's hold sheet: the row's RowMenu (core costRowMenu, the same
// actions web shows on a right-click), drawn the way the Groceries and Tasks
// hold sheets are. The header states the row (E1), "Move to" opens in place
// as the category grid, and Archive or Hide sits alone at the end (E4).
// Web twin: the right-click menu (components/ui/row-context-menu.tsx) and,
// on touch, apps/web/src/app/costs/cost-row-sheet.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Archive, ArrowUpRight, EyeOff, MessageSquare, Pencil, type LucideIcon } from 'lucide-react-native';
import { BottomSheet, Text, cn, haptics } from '@homeup/ui';
import { arrangeRowActions, type CostCategory, type RowAction, type RowActionIcon, type RowMenu } from '@homeup/core';
import { CategoryChip } from './cost-card';
import { CategoryGrid } from './category-picker';

const ICONS: Partial<Record<RowActionIcon, LucideIcon>> = {
  open: ArrowUpRight,
  comment: MessageSquare,
  edit: Pencil,
  archive: Archive,
  hide: EyeOff,
};

export interface CostRowSheetState {
  menu: RowMenu;
  category: CostCategory | null;
  /** The figure on the right of the header. */
  amount?: string;
  /** One caption under the title. */
  meta?: string;
}

export function CostRowSheet({ state, choices, onClose }: { state: CostRowSheetState | null; choices: readonly CostCategory[]; onClose: () => void }) {
  const groups = state ? arrangeRowActions(state.menu.actions) : [];
  const run = (a: RowAction) => {
    onClose();
    // Let the sheet go before the next one (an editor, a picker) comes up.
    setTimeout(() => a.run?.(), 0);
  };
  return (
    <BottomSheet open={!!state} onOpenChange={(o) => { if (!o) onClose(); }} className="pb-3">
      {state ? (
        <>
          <View className="flex-row items-center gap-2.5 border-b border-border px-4 pb-3">
            {state.category ? <CategoryChip category={state.category} /> : <View className="h-7 w-7 rounded-[9px] border border-dashed border-muted-foreground/60" />}
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
                {state.menu.title}
              </Text>
              {state.meta || state.menu.kind ? (
                <Text numberOfLines={1} className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {state.meta ?? state.menu.kind}
                </Text>
              ) : null}
            </View>
            {state.amount ? (
              <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {state.amount}
              </Text>
            ) : null}
          </View>
          <ScrollView className="max-h-[520px] px-1 pt-1">
            {groups.map((group, gi) => (
              <View key={group[0].group} className={cn(gi > 0 && 'mt-1 border-t border-border pt-1')}>
                {group.map((a) =>
                  a.options ? (
                    <View key={a.id} className="gap-2 px-3 pb-2 pt-2">
                      <Text className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{a.label}</Text>
                      <CategoryGrid
                        choices={choices}
                        current={(a.options.find((o) => o.checked)?.id as CostCategory | undefined) ?? null}
                        onPick={(c) => {
                          const option = a.options!.find((o) => o.id === c);
                          if (!option || option.checked) return;
                          haptics.tick();
                          onClose();
                          option.run();
                        }}
                      />
                    </View>
                  ) : (
                    <MenuItem key={a.id} action={a} onPress={() => run(a)} />
                  ),
                )}
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
    </BottomSheet>
  );
}

function MenuItem({ action, onPress }: { action: RowAction; onPress: () => void }) {
  const Icon = action.icon ? ICONS[action.icon] : undefined;
  const danger = action.danger || action.group === 'danger';
  return (
    <Pressable accessibilityRole="menuitem" onPress={onPress} className="min-h-11 flex-row items-center gap-2.5 rounded-lg px-3 py-2.5">
      {Icon ? <Icon size={14} className={danger ? 'text-destructive' : 'text-muted-foreground'} /> : null}
      <Text className={cn('flex-1 text-body', danger ? 'font-medium text-destructive' : 'text-foreground')}>{action.label}</Text>
      {action.value ? <Text className="text-sm text-muted-foreground">{action.value}</Text> : null}
    </Pressable>
  );
}
