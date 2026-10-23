// HOUP-85: native port of apps/web's app/home/groceries-widget.tsx — the
// expandable Home hub groceries card (HOUP-77 folded this into a flat tile;
// this restores the real card). Renders the same GroceryItemCard the
// /groceries screen uses, a quick-add row, and suggest-re-add — instead of a
// bespoke mini-row. Trimmed from web for this pass: the ~10s fade-out linger
// animation on a just-marked-'have' row is dropped (cosmetic; the row still
// disappears correctly on the next store read, just without the transition) —
// everything else (essentials-always-shown, small-list-shows-everything,
// large-list-collapses-to-chips, suggest-re-add, quick-add) is faithful.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { use$ } from '@legendapp/state/react';
import { ChevronRight, Plus, ShoppingCart, Star } from 'lucide-react-native';
import { Text, Card, IngredientNameInput, LeadingTile, haptics } from '@homeup/ui';
import {
  countNeeded,
  resolveItemDefaults,
  suggestReAdd,
  groceryItems$,
  useReconnectSync,
  useStoreHelpers,
  compareStrings,
  HOME_RE_ADD_CHIP_CAP,
  todayISO,
  type GroceryItem,
  type Group,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
import { useGroceryAux } from '@/features/groceries/use-grocery-aux';
import { GroceryItemCard } from '@/features/groceries/grocery-item-card';
import { ReAddSuggestions } from '@/features/groceries/re-add-suggestions';
import { useGroceryArchive } from '@/features/groceries/use-grocery-archive';
import { useSuggestDismiss } from '@/features/groceries/use-suggest-dismiss';
import { useGroceryUndo } from '@/features/groceries/use-grocery-undo';
import { GroceryItemFormSheet } from '@/features/groceries/grocery-item-form-sheet';

// Mirrors apps/web/src/app/home/hub-shared.tsx's HUB tunables (kept local —
// those live in a web-only, JSX-adjacent module apps/mobile can't import).
const GROCERY_EXPAND_THRESHOLD = 10;

const HIDDEN = { display: 'none' } as const;

export function GroceriesWidget({
  group,
  currentUserId,
  expanded = false,
}: {
  group: Group;
  currentUserId: string | null;
  /** Hearth v2: Home is filtered to this Space (its shortcut), so show the whole list. */
  expanded?: boolean;
}) {
  const router = useRouter();
  const { customAisles, libMap } = useGroceryAux(group.id);
  const items$ = groceryItems$(group.id);
  useReconnectSync(items$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);
  const archiveItem = useGroceryArchive(group.id, patchRow, softDeleteRow);
  const groceryUndo = useGroceryUndo(patchRow);
  const suggestDismiss = useSuggestDismiss({ hide: groceryUndo.hide, archive: archiveItem });

  const allItems = use$(() => Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted));
  const needed = countNeeded(allItems);

  const reAddSuggestions = React.useMemo(() => suggestReAdd(allItems, libMap), [allItems, libMap]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<GroceryItem | undefined>();
  const [quickAddDraft, setQuickAddDraft] = React.useState('');

  const showFullList = expanded || needed < GROCERY_EXPAND_THRESHOLD;
  const fullItems = React.useMemo(() => {
    const today = todayISO();
    return allItems
      .filter((i) => i.status === 'needed' || (i.status === 'bought' && i.last_purchased_at === today))
      .sort((a, b) => {
        const rank = (i: GroceryItem) => (i.status === 'needed' ? (i.is_essential ? 0 : 1) : 2);
        return rank(a) - rank(b) || compareStrings(a.name, b.name);
      });
  }, [allItems]);
  const cardItems = React.useMemo(
    () => (showFullList ? fullItems : fullItems.filter((i) => i.status === 'needed' && i.is_essential)),
    [fullItems, showFullList]
  );
  const cardIds = React.useMemo(() => new Set(cardItems.map((i) => i.id)), [cardItems]);
  // Once Home has been filtered to Groceries, the full list stays mounted and
  // collapsing only hides rows: remounting dozens of swipeable rows on every
  // toggle is what made the filter lag.
  const [keepFullMounted, setKeepFullMounted] = React.useState(false);
  if (expanded && !keepFullMounted) setKeepFullMounted(true);
  const renderedItems = showFullList || keepFullMounted ? fullItems : cardItems;

  const overflowNames = React.useMemo(
    () =>
      allItems
        .filter((i) => i.status === 'needed' && !cardIds.has(i.id))
        .map((i) => i.name)
        .sort(),
    [allItems, cardIds]
  );

  const suggestions = React.useMemo(() => {
    const seen = new Map<string, string>(); // lowercased → first-seen display form
    // Rows still syncing in on a fresh install can lack a name.
    const add = (raw: string | null | undefined) => {
      if (typeof raw !== 'string' || !raw) return;
      const k = raw.toLowerCase().trim();
      if (k && !seen.has(k)) seen.set(k, raw.trim());
    };
    for (const lib of libMap.values()) add(lib.item_name);
    for (const item of allItems) add(item.name);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [libMap, allItems]);

  const annotateQuickAdd = React.useCallback(
    (name: string) => {
      const match = allItems.find((i) => i.name?.toLowerCase() === name.toLowerCase());
      if (match && (match.status === 'have' || match.status === 'bought')) {
        return { label: match.status, className: 'text-muted-foreground' };
      }
      return null;
    },
    [allItems]
  );

  const handleQuickAdd = (explicitName?: string) => {
    const name = (explicitName ?? quickAddDraft).trim();
    if (!name) return;
    haptics.commit();
    setQuickAddDraft('');
    const existing = allItems.find((i) => i.name?.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.status !== 'needed') {
        patchRow(existing.id, { status: 'needed', last_purchased_at: null, status_changed_at: new Date().toISOString() });
      }
      return;
    }
    const now = new Date().toISOString();
    writeRow({
      id: randomUUID(),
      group_id: group.id,
      name,
      aisle: 'other',
      quantity: null,
      unit: null,
      status: 'needed',
      notes: null,
      assigned_to: null,
      private: false,
      template_key: null,
      sort_order: 0,
      created_by: currentUserId,
      updated_by: currentUserId,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      deleted: false,
      recurrence_days: null,
      status_changed_at: now,
      last_purchased_at: null,
      last_price: null,
      lowest_price: null,
      expiry_date: null,
      shelf_life_days: null,
      price_cents: null,
      is_essential: false,
      recipe_note: null,
      recipe_source_id: null,
      re_add_snoozed_until: null,
      re_add_dismissed_at: null,
    });
  };

  return (
    <Card>
      <View className="gap-3 px-4">
        <Pressable onPress={() => router.push('/groceries')} className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2.5">
            <LeadingTile sectionId="groceries" Icon={ShoppingCart} size="md" />
            <Text className="text-title text-foreground">Groceries</Text>
          </View>
          <Text className="rounded-full bg-muted px-2 py-0.5 text-caption font-semibold text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {needed} needed
          </Text>
        </Pressable>

        <View className="flex-row items-center gap-2">
          <Plus size={14} className="text-muted-foreground" />
          <IngredientNameInput
            value={quickAddDraft}
            onChange={(next) => {
              setQuickAddDraft(next);
              // A suggestion tap replaces the whole field in one call, so a
              // full-value jump (grows by more than one character) can only
              // come from picking a suggestion, never from typing — finalize
              // the add immediately in that case (IngredientNameInput has no
              // separate onSelect callback to distinguish the two).
              const isSuggestionPick = next.length - quickAddDraft.length > 1 && suggestions.some((s) => s.toLowerCase() === next.toLowerCase());
              if (isSuggestionPick) handleQuickAdd(next);
            }}
            suggestions={suggestions}
            annotate={annotateQuickAdd}
            onSubmitEditing={() => handleQuickAdd()}
            returnKeyType="done"
            placeholder="Add to the list…"
            className="flex-1"
          />
        </View>

        <ReAddSuggestions
          runningLow={reAddSuggestions}
          cap={HOME_RE_ADD_CHIP_CAP}
          onAdd={groceryUndo.needAgain}
          onAddAll={() => groceryUndo.needAgain(reAddSuggestions)}
          onSnooze={groceryUndo.snooze}
          dismissAction={suggestDismiss.dismissAction}
          onDismiss={suggestDismiss.dismiss}
        />

        {cardItems.length === 0 && overflowNames.length === 0 && reAddSuggestions.length === 0 && (
          <Text className="text-body text-muted-foreground">Nothing on the shopping list. Remember to add something.</Text>
        )}

        {!showFullList && cardItems.length > 0 && (
          <View className="flex-row items-center gap-1">
            <Star size={12} className="fill-current text-warning" />
            <Text className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Essentials to grab</Text>
          </View>
        )}

        {cardItems.length > 0 && (
          <View className="gap-1.5">
            {renderedItems.map((item) => (
              <View key={item.id} style={cardIds.has(item.id) ? undefined : HIDDEN}>
                <GroceryItemCard
                  item={item}
                  customAisles={customAisles}
                  resolvedShelfLifeDays={resolveItemDefaults(item.name, libMap).days}
                  onPatch={patchRow}
                  onEdit={(it) => {
                    setEditingItem(it);
                    setFormOpen(true);
                  }}
                />
              </View>
            ))}
          </View>
        )}

        {overflowNames.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-1.5">
              {overflowNames.slice(0, 6).map((n) => (
                <Text key={n} className="rounded-full bg-muted px-2.5 py-1 text-caption text-muted-foreground">
                  {n}
                </Text>
              ))}
              {overflowNames.length > 6 && (
                <Text className="rounded-full px-2.5 py-1 text-caption text-muted-foreground">+{overflowNames.length - 6} more</Text>
              )}
            </View>
          </ScrollView>
        )}

        <Pressable
          onPress={() => router.push('/groceries')}
          accessibilityRole="link"
          className="min-h-[44px] flex-row items-center gap-1 self-end px-1"
        >
          <Text className="text-body font-medium text-primary">Open groceries</Text>
          <ChevronRight size={16} className="text-primary" />
        </Pressable>
      </View>

      <GroceryItemFormSheet
        key={editingItem?.id ?? 'none'}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingItem(undefined);
        }}
        item={editingItem}
        groupId={group.id}
        currentUserId={currentUserId}
        customAisles={customAisles}
        libMap={libMap}
        onSave={(saved) => {
          writeRow(saved);
          setFormOpen(false);
          setEditingItem(undefined);
        }}
      />
    </Card>
  );
}

