// "Re-add suggestions": items that are probably running low (have-it past
// shelf life) as compact chips carrying the essential star and how many days
// overdue. Only a handful show; "Show N more" reveals the rest. Tapping a
// chip adds it back (the caller shows the Undo pill). Long-pressing a chip
// (with the shared hold fill and haptic) opens Snooze / Stop suggesting;
// Full review (next to Show more) expands the full rows (emoji, days, Add / Snooze / X). Mirrors
// apps/web/src/app/groceries/re-add-suggestions.tsx.
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Plus, Star } from 'lucide-react-native';
import { BottomSheet, Button, HoldFillOverlay, ListGroup, ListItem, ListItemTitle, Text, haptics, useHoldFill } from '@homeup/ui';
import {
  RE_ADD_CHIP_CAP,
  GROCERY_DISMISS_ACTIONS,
  GROCERY_DISMISS_LABELS,
  snoozeUntilISO,
  type GroceryDismissAction,
  type SuggestReAddItem,
} from '@homeup/core';
import { SuggestReAddSection } from './suggest-re-add-section';

const CHIP_CLASS = 'relative min-h-9 flex-row overflow-hidden items-center gap-1 rounded-full border border-border bg-muted px-3 py-1.5';

interface ReAddSuggestionsProps {
  runningLow: SuggestReAddItem[];
  onAdd: (item: SuggestReAddItem) => void;
  onAddAll: () => void;
  onSnooze: (item: SuggestReAddItem, untilISO: string) => void;
  /** The remembered X choice; null = offer both Not now and Archive. */
  dismissAction: GroceryDismissAction | null;
  onDismiss: (item: SuggestReAddItem, action: GroceryDismissAction) => void;
  /** Chips shown before "Show N more"; the Home card passes a smaller cap. */
  cap?: number;
  /** 'group' (Groceries screen) heads the chips like an aisle: "Running low n"
   *  with Add all and Review as text buttons on that line, so the block reads
   *  as the list's first group instead of three rows of chrome. */
  variant?: 'default' | 'group';
}

export function ReAddSuggestions({
  runningLow,
  onAdd,
  onAddAll,
  onSnooze,
  dismissAction,
  onDismiss,
  cap = RE_ADD_CHIP_CAP,
  variant = 'default',
}: ReAddSuggestionsProps) {
  const [reviewing, setReviewing] = React.useState(false);
  const [showAllLow, setShowAllLow] = React.useState(false);
  const [menuTarget, setMenuTarget] = React.useState<SuggestReAddItem | null>(null);
  React.useEffect(() => {
    if (runningLow.length === 0) setReviewing(false);
    if (runningLow.length <= cap) setShowAllLow(false);
  }, [runningLow.length, cap]);

  if (runningLow.length === 0) return null;

  const hiddenLow = showAllLow ? 0 : Math.max(0, runningLow.length - cap);
  const visibleLow = hiddenLow > 0 ? runningLow.slice(0, cap) : runningLow;
  const dismissChoices = dismissAction ? [dismissAction] : GROCERY_DISMISS_ACTIONS;
  const closeMenu = () => setMenuTarget(null);
  // A bulk add gets a confirm on top of the Undo pill (Guy, 2026-10-18).
  const confirmAddAll = () =>
    Alert.alert(`Add all ${runningLow.length} suggestions?`, 'They move back to Needed on your list.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add all', onPress: onAddAll },
    ]);

  return (
    <View className="gap-2">
      {variant === 'group' ? (
        <View className="min-h-9 flex-row items-center gap-1.5 px-1">
          <Text className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-foreground">Might be running low</Text>
          <Text className="text-xs text-muted-foreground/70" style={{ fontVariant: ['tabular-nums'] }}>
            {runningLow.length}
          </Text>
          <View className="flex-1" />
          {runningLow.length >= 2 && (
            <Pressable onPress={confirmAddAll} accessibilityRole="button" hitSlop={8} className="min-h-9 justify-center px-1.5">
              <Text className="text-sm font-medium text-primary">Add all</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setReviewing((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: reviewing }}
            hitSlop={8}
            className="min-h-9 justify-center px-1.5"
          >
            <Text className="text-sm font-medium text-primary">{reviewing ? 'Done' : 'Review'}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="min-h-9 flex-row items-center gap-2 px-1">
          <Text className="flex-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Re-add suggestions{' '}
            <Text className="text-[10.5px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {runningLow.length}
            </Text>
          </Text>
          {runningLow.length >= 2 && (
            <Button size="sm" variant="outline" onPress={confirmAddAll}>
              Add all {runningLow.length}
            </Button>
          )}
        </View>
      )}

      {reviewing ? (
        <SuggestReAddSection
          bare
          items={runningLow}
          onAdd={onAdd}
          onSnooze={onSnooze}
          dismissAction={dismissAction}
          onDismiss={onDismiss}
        />
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {visibleLow.map((item) => (
            <ReAddChip key={item.id} item={item} onAdd={() => onAdd(item)} onLongPress={() => setMenuTarget(item)} />
          ))}
        </View>
      )}

      {/* Footer: more chips, or the full rows with every control (the group
          variant carries Review on its header line instead). */}
      {(variant !== 'group' || (!reviewing && runningLow.length > cap)) && (
        <View className="flex-row flex-wrap gap-2">
          {!reviewing && runningLow.length > cap && (
            <Button size="sm" variant="ghost" onPress={() => setShowAllLow((v) => !v)}>
              {hiddenLow > 0 ? `Show ${hiddenLow} more` : 'Show fewer'}
            </Button>
          )}
          {variant !== 'group' && (
            <Button size="sm" variant="ghost" onPress={() => setReviewing((v) => !v)} accessibilityState={{ expanded: reviewing }}>
              {reviewing ? 'Compact view' : 'Full review'}
            </Button>
          )}
        </View>
      )}

      <BottomSheet open={!!menuTarget} onOpenChange={(open) => !open && closeMenu()} className="pb-2">
        {menuTarget && (
          <>
            <View className="px-4 pt-2">
              <Text className="text-[15px] font-semibold text-foreground">{menuTarget.name}</Text>
              <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {menuTarget.daysOverdue}d past shelf life
              </Text>
            </View>
            <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
              {(['1d', '1w', '1m'] as const).map((key) => (
                <ListItem
                  key={key}
                  onPress={() => {
                    onSnooze(menuTarget, snoozeUntilISO(key));
                    closeMenu();
                  }}
                >
                  <ListItemTitle>{SNOOZE_LABELS[key]}</ListItemTitle>
                </ListItem>
              ))}
              {dismissChoices.map((action) => (
                <ListItem
                  key={action}
                  onPress={() => {
                    onDismiss(menuTarget, action);
                    closeMenu();
                  }}
                >
                  <ListItemTitle>{dismissAction ? 'Stop suggesting' : GROCERY_DISMISS_LABELS[action].title}</ListItemTitle>
                </ListItem>
              ))}
            </ListGroup>
          </>
        )}
      </BottomSheet>
    </View>
  );
}

const LONG_PRESS_MS = 500;

/** Tap adds; long-press (with the hold fill and a commit haptic) opens the menu. */
function ReAddChip({ item, onAdd, onLongPress }: { item: SuggestReAddItem; onAdd: () => void; onLongPress: () => void }) {
  const holdFill = useHoldFill(LONG_PRESS_MS);
  return (
    <Pressable
      onPress={onAdd}
      onPressIn={holdFill.start}
      onPressOut={holdFill.stop}
      delayLongPress={LONG_PRESS_MS}
      onLongPress={() => {
        holdFill.stop();
        haptics.commit();
        onLongPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Need ${item.name} again, ${item.daysOverdue} days past shelf life`}
      accessibilityHint="Long-press to snooze or stop suggesting"
      className={CHIP_CLASS}
    >
      <HoldFillOverlay progress={holdFill.progress} />
      {item.is_essential ? <Star size={12} className="fill-current text-warning" /> : <Plus size={12} className="text-primary" />}
      <Text className="text-sm text-foreground">{item.name}</Text>
      <Text className="font-mono text-[11.5px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {item.daysOverdue}d
      </Text>
    </Pressable>
  );
}

const SNOOZE_LABELS = { '1d': 'Snooze until tomorrow', '1w': 'Snooze a week', '1m': 'Snooze a month' } as const;
