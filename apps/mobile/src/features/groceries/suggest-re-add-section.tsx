// HOUP-80: native port of apps/web/src/app/groceries/suggest-re-add-section.tsx
// — a "have it" item whose shelf life has passed, offering re-add or snooze.
//
// HOUP-173: matches web's card (chevron-collapsible header, "Add" placed
// BEFORE "Snooze"). Hearth v2 (H2/H4): a neutral rounded-3xl card with
// neutral buttons; the amber rail, tint and day labels and the green-filled
// Add are gone (Add item keeps the screen's one accent fill).
//
// Dismiss (trailing X) is for one-offs: it runs the user's remembered choice
// (Not now or Archive, see core's grocery-dismiss.ts), asking once via
// DismissSheet when none is stored yet.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react-native';
import { Text, Button, Card, GroceryGlyph } from '@homeup/ui';
import { GROCERY_SUGGEST_CAP, getGroceryEmoji, type GroceryDismissAction, type SuggestReAddItem } from '@homeup/core';
import { SnoozeSheet } from './snooze-sheet';
import { DismissSheet } from './dismiss-sheet';

interface SuggestReAddSectionProps {
  items: SuggestReAddItem[];
  onAdd: (item: SuggestReAddItem) => void;
  onSnooze: (item: SuggestReAddItem, untilISO: string) => void;
  /** The remembered X choice; null = ask with DismissSheet first. */
  dismissAction: GroceryDismissAction | null;
  onDismiss: (item: SuggestReAddItem, action: GroceryDismissAction) => void;
  /** HOUP-317: moves every suggestion to `needed` in one action. Only offered
   *  at 2+ suggestions — the Home hub widget doesn't pass this. */
  onAddAll?: () => void;
  /** Just the rows, all of them: no frame, header or cap. The Buy again
   *  section's Review list uses this. */
  bare?: boolean;
}

export function SuggestReAddSection({ items, onAdd, onSnooze, dismissAction, onDismiss, onAddAll, bare }: SuggestReAddSectionProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [snoozeTarget, setSnoozeTarget] = React.useState<SuggestReAddItem | null>(null);
  const [dismissTarget, setDismissTarget] = React.useState<SuggestReAddItem | null>(null);
  // HOUP-317: above the cap, only the top N render until expanded. Reset once
  // the list falls back to (or below) the cap so the expansion doesn't linger.
  const [showAll, setShowAll] = React.useState(false);
  React.useEffect(() => {
    if (items.length <= GROCERY_SUGGEST_CAP) setShowAll(false);
  }, [items.length]);

  if (items.length === 0) return null;

  const renderRow = (item: SuggestReAddItem) => (
    <View key={item.id} className="flex-row items-center gap-2 rounded-xl bg-card px-3 py-2.5">
      <GroceryGlyph emoji={getGroceryEmoji(item.name, item.aisle)} size={20} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm font-medium text-foreground">
          {item.name}
        </Text>
        <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {item.daysOverdue}d past shelf life
        </Text>
      </View>
      <View className="flex-row shrink-0 items-center gap-1.5">
        {/* Add before Snooze in reading/tab order. */}
        <Button size="sm" variant="outline" onPress={() => onAdd(item)}>
          <Plus size={14} className="text-foreground" />
          <Text className="text-xs font-medium text-foreground">Add</Text>
        </Button>
        <Button size="sm" variant="outline" onPress={() => setSnoozeTarget(item)}>
          Snooze
        </Button>
        <Button
          size="icon"
          variant="ghost"
          accessibilityLabel={`Stop suggesting ${item.name}`}
          hitSlop={6}
          onPress={() => (dismissAction ? onDismiss(item, dismissAction) : setDismissTarget(item))}
        >
          <X size={16} className="text-muted-foreground" />
        </Button>
      </View>
    </View>
  );

  const sheets = (
    <>
      <SnoozeSheet
        open={!!snoozeTarget}
        onOpenChange={(open) => !open && setSnoozeTarget(null)}
        onSnooze={(untilISO) => {
          if (snoozeTarget) onSnooze(snoozeTarget, untilISO);
          setSnoozeTarget(null);
        }}
      />
      <DismissSheet
        itemName={dismissTarget?.name ?? null}
        onOpenChange={(open) => !open && setDismissTarget(null)}
        onPick={(action) => {
          if (dismissTarget) onDismiss(dismissTarget, action);
          setDismissTarget(null);
        }}
      />
    </>
  );

  if (bare) {
    return (
      <View className="gap-1.5">
        {items.map(renderRow)}
        {sheets}
      </View>
    );
  }

  const truncated = items.length > GROCERY_SUGGEST_CAP && !showAll;
  const visible = truncated ? items.slice(0, GROCERY_SUGGEST_CAP) : items;

  return (
    <Card className="flex-row gap-0 rounded-3xl py-0">
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2 p-3">
          <Pressable onPress={() => setCollapsed((c) => !c)} className="flex-1 flex-row items-center gap-2">
            {collapsed ? (
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
            )}
            <Text className="text-[15px] font-semibold text-foreground">
              Might be running low{' '}
              <Text className="font-normal text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {items.length}
              </Text>
            </Text>
          </Pressable>
          {onAddAll && items.length >= 2 && (
            <Button size="sm" variant="outline" onPress={onAddAll}>
              Add all {items.length}
            </Button>
          )}
        </View>
        {!collapsed && (
          <View className="gap-1.5 px-3 pb-3">
            {visible.map(renderRow)}
            {truncated && (
              <Pressable onPress={() => setShowAll(true)} className="min-h-11 items-center justify-center rounded-lg py-2.5">
                <Text className="text-sm text-primary">
                  <Text className="font-semibold">{items.length - GROCERY_SUGGEST_CAP} more</Text> past shelf life
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      {sheets}
    </Card>
  );
}
