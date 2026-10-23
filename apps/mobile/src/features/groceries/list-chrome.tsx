import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ArrowUpDown, MoreHorizontal, Plus, Receipt, RotateCcw, Search, WalletCards } from 'lucide-react-native';
import { Text, type ActionMenuAnchor, Button, Card, cn, HeroLede, Input, SectionSearchBar, SegmentedControl } from '@homeup/ui';
import { CUSTOM_AISLE_COLOR_KEYS, getAisleColor, type GroceryShowFilter, formatMoney, MOTION_DURATIONS_MS, type GrocerySortMode, type SuggestReAddItem, type GroceryDismissAction } from '@homeup/core';
import { ReAddSuggestions } from '@/features/groceries/re-add-suggestions';
import { SwipeHintCard } from '@/features/groceries/swipe-hint-card';

export interface GroceriesListHeaderProps {
  itemsCount: number;
  neededCount: number;
  caption: string | undefined;
  staplesAvailable: boolean;
  onSeedStaples: () => void;
  modeActive: boolean;
  onExitMode: () => void;
  onOpenMore: (anchor: ActionMenuAnchor) => void;
  sortMode: GrocerySortMode;
  onSortModeChange: (mode: GrocerySortMode) => void;
  show: GroceryShowFilter;
  onShowChange: (show: GroceryShowFilter) => void;
  onOpenCards: () => void;
  onAddItem: () => void;
  onHeadLayout: (bottom: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  suggestions: SuggestReAddItem[];
  onSuggestAdd: (item: SuggestReAddItem) => void;
  onSuggestSnooze: (item: SuggestReAddItem, untilISO: string) => void;
  suggestDismissAction: GroceryDismissAction | null;
  onSuggestDismiss: (item: SuggestReAddItem, action: GroceryDismissAction) => void;
  onSuggestAddAll: () => void;
}

/** An outline icon button that opens an ActionMenu under itself. `dot` marks
 *  a non-default state behind it (a filter that's on). */
export function MenuIconButton({
  label,
  onOpen,
  dot,
  children,
}: {
  label: string;
  onOpen: (anchor: ActionMenuAnchor) => void;
  dot?: boolean;
  children: React.ReactNode;
}) {
  const ref = React.useRef<View>(null);
  return (
    <View ref={ref} collapsable={false}>
      <Button
        size="icon-sm"
        variant="outline"
        accessibilityLabel={label}
        onPress={() => ref.current?.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }))}
      >
        {children}
      </Button>
      {dot && <View pointerEvents="none" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />}
    </View>
  );
}

/** HOUP-207: the groceries lede, search, and Running low group —
 * hoisted into `FlashList`'s `ListHeaderComponent` (and reused verbatim atop
 * the reorder-mode `ScrollView`) so it scrolls with content in both modes.
 * Passed as a memoized element (never an inline closure) so the search bar's
 * input never remounts mid-type.
 *
 * Compact header (Guy, 2026-10-20): the lede is one row with the actions
 * beside it (Rewards cards stays one tap away, everything else sits in More),
 * the list view options are a menu beside search, re-add suggestions read as
 * the list's first group, and the estimate moved to the This trip summary at
 * the end of the list. Once this block scrolls away the collapsed bar takes
 * over (GroceriesCollapsedBar). */
export function GroceriesListHeader({
  itemsCount,
  neededCount,
  caption,
  staplesAvailable,
  onSeedStaples,
  modeActive,
  onExitMode,
  onOpenMore,
  sortMode,
  onSortModeChange,
  show,
  onShowChange,
  onOpenCards,
  onAddItem,
  onHeadLayout,
  search,
  onSearchChange,
  onSearchSubmit,
  suggestions,
  onSuggestAdd,
  onSuggestSnooze,
  suggestDismissAction,
  onSuggestDismiss,
  onSuggestAddAll,
}: GroceriesListHeaderProps) {
  return (
    <View className="gap-3 pb-4">
      <View className="gap-3" onLayout={(e) => onHeadLayout(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        {/* Lede (Hearth H1/H6): value-first, mirrors web page.tsx's grammar.
            H5: Add is the screen's one accent fill. */}
        <HeroLede
          layout="inline"
          value={neededCount}
          label="to buy"
          caption={caption}
          trailing={
            <View className="flex-row items-center gap-2">
              {/* Rewards cards: one tap to the checkout barcode (a household
                  with one card lands straight on it). */}
              <Button size="icon-sm" variant="outline" onPress={onOpenCards} accessibilityLabel="Rewards cards">
                <WalletCards size={16} className="text-foreground" />
              </Button>
              {/* Select and Reorder live in More; while one is on, Done takes
                  More's place so the mode is never stuck behind a menu. */}
              {modeActive ? (
                <Button size="sm" variant="outline" onPress={onExitMode}>
                  Done
                </Button>
              ) : (
                <MenuIconButton label="More" onOpen={onOpenMore}>
                  <MoreHorizontal size={16} className="text-foreground" />
                </MenuIconButton>
              )}
              <Button size="sm" onPress={onAddItem}>
                <Plus size={14} className="text-primary-foreground" />
                <Text className="text-sm font-medium text-primary-foreground">Add</Text>
              </Button>
            </View>
          }
        />

        <View className="flex-row items-center gap-2">
          <SectionSearchBar
            value={search}
            onChange={onSearchChange}
            onSubmit={onSearchSubmit}
            placeholder="Search or add, e.g. 2 milk"
            className="flex-1"
          />
        </View>
      </View>

      {/* While searching, the results sit directly under the search bar: the
          Running low group and the empty state step aside until the query
          is cleared. The trip itself floats (ShopTrackingPill). */}
      {!search.trim() && (
        <>
          {/* Re-add suggestions as compact chips under a "Running low" group
              head (replaced both the Buy again chips and the "Might be
              running low" rows). */}
          <ReAddSuggestions
            variant="group"
            runningLow={suggestions}
            onAdd={onSuggestAdd}
            onAddAll={onSuggestAddAll}
            onSnooze={onSuggestSnooze}
            dismissAction={suggestDismissAction}
            onDismiss={onSuggestDismiss}
          />

          {itemsCount === 0 ? (
            <Card className="items-center gap-3 rounded-3xl px-4 py-8">
              <Text className="text-center text-body text-muted-foreground">Add items, or start from the starter staples.</Text>
              {staplesAvailable && (
                <Pressable
                  onPress={onSeedStaples}
                  className="min-h-11 flex-row items-center gap-1.5 rounded-lg border border-border bg-muted px-4 py-2"
                >
                  <Plus size={14} className="text-foreground" />
                  <Text className="text-sm text-foreground">Add starter staples</Text>
                </Pressable>
              )}
            </Card>
          ) : (
            // M3: first-run gesture-discovery hint — teaches the swipe-to-shop
            // gesture with a visible, non-gesture path; dismisses itself.
            <SwipeHintCard />
          )}
        </>
      )}

      {itemsCount > 0 && (
        <GroceriesListBar sortMode={sortMode} onSortModeChange={onSortModeChange} show={show} onShowChange={onShowChange} />
      )}
    </View>
  );
}

/** The list bar (Guy, 2026-10-22, option C): what the list holds and how it
 *  is arranged, as two small toggles right above the rows they control. */
export function GroceriesListBar({
  sortMode,
  onSortModeChange,
  show,
  onShowChange,
}: {
  sortMode: GrocerySortMode;
  onSortModeChange: (mode: GrocerySortMode) => void;
  show: GroceryShowFilter;
  onShowChange: (show: GroceryShowFilter) => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-2 pt-1">
      <SegmentedControl
        accessibilityLabel="Show"
        fitContent
        size="sm"
        tone="accent"
        options={[
          { value: 'needed', label: 'To buy' },
          { value: 'all', label: 'All items' },
        ]}
        value={show}
        onChange={onShowChange}
      />
      <SegmentedControl
        accessibilityLabel="Arrange"
        fitContent
        size="sm"
        options={[
          { value: 'aisle', label: 'Aisles' },
          { value: 'flat', label: 'One list' },
        ]}
        value={sortMode}
        onChange={onSortModeChange}
      />
    </View>
  );
}

export interface GroceriesTripSummaryProps {
  estTotal: number;
  buyableCount: number;
  unpricedCount: number;
  showTrack: boolean;
  onTrack: () => void;
  boughtStatusCount: number;
  onResetBought: () => void;
}

/** "This trip": the estimate (was the Est total pulse tile) and the trip's
 *  quiet actions, at the end of the list where you land after the last aisle
 *  (Guy, 2026-10-20). Reset bought stays behind its confirm. */
export function GroceriesTripSummary({ estTotal, buyableCount, unpricedCount, showTrack, onTrack, boughtStatusCount, onResetBought }: GroceriesTripSummaryProps) {
  return (
    <Card className="mt-6 gap-2.5 rounded-3xl px-4 py-3.5">
      <Text className="text-micro-label uppercase text-muted-foreground">This trip</Text>
      <View className="flex-row flex-wrap items-baseline gap-x-2">
        <Text className="text-display text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          ~{formatMoney(estTotal)}
        </Text>
        <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          estimated for {buyableCount} {buyableCount === 1 ? 'item' : 'items'}
          {unpricedCount > 0 ? ` · ${unpricedCount} unpriced` : ''}
        </Text>
      </View>
      {(showTrack || boughtStatusCount > 0) && (
        <View className="flex-row flex-wrap gap-2">
          {showTrack && (
            <Button size="sm" variant="outline" onPress={onTrack}>
              <Receipt size={14} className="text-foreground" />
              <Text className="text-sm font-medium text-foreground">Track shop</Text>
            </Button>
          )}
          {boughtStatusCount > 0 && (
            <Button size="sm" variant="outline" onPress={onResetBought}>
              <RotateCcw size={14} className="text-foreground" />
              <Text className="text-sm font-medium text-foreground">Reset bought ({boughtStatusCount})</Text>
            </Button>
          )}
        </View>
      )}
    </Card>
  );
}

export interface GroceriesCollapsedBarProps {
  topInset: number;
  neededCount: number;
  show: GroceryShowFilter;
  onShowChange: (show: GroceryShowFilter) => void;
  onSearch: () => void;
  onOpenCards: () => void;
  onOpenView: (anchor: ActionMenuAnchor) => void;
  onAddItem: () => void;
}

/** The slim bar that takes over once the lede has scrolled away, so the list
 *  gets the screen while you shop: the count and the Show switch, then search
 *  (back to the top), Rewards cards, sort and Add. */
export function GroceriesCollapsedBar({ topInset, neededCount, show, onShowChange, onSearch, onOpenCards, onOpenView, onAddItem }: GroceriesCollapsedBarProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(MOTION_DURATIONS_MS.fast)}
      exiting={FadeOut.duration(MOTION_DURATIONS_MS.fast)}
      className="absolute inset-x-0 top-0 z-30 border-b border-border bg-background/95"
      style={{ paddingTop: topInset }}
    >
      <View className="h-16 flex-row items-center gap-2 px-4">
        <Text accessibilityRole="header" className="text-display text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {neededCount}
        </Text>
        <View className="min-w-0 flex-1">
          <SegmentedControl
            accessibilityLabel="Show"
            fitContent
            size="sm"
            tone="accent"
            options={[
              { value: 'needed', label: 'To buy' },
              { value: 'all', label: 'All' },
            ]}
            value={show}
            onChange={onShowChange}
          />
        </View>
        <Button size="icon-sm" variant="outline" onPress={onSearch} accessibilityLabel="Search or add">
          <Search size={16} className="text-foreground" />
        </Button>
        <Button size="icon-sm" variant="outline" onPress={onOpenCards} accessibilityLabel="Rewards cards">
          <WalletCards size={16} className="text-foreground" />
        </Button>
        <MenuIconButton label="Sort" onOpen={onOpenView}>
          <ArrowUpDown size={16} className="text-foreground" />
        </MenuIconButton>
        <Button size="icon-sm" onPress={onAddItem} accessibilityLabel="Add item" className="rounded-full">
          <Plus size={16} className="text-primary-foreground" />
        </Button>
      </View>
    </Animated.View>
  );
}

export interface GroceriesAddAisleFooterProps {
  addAisleOpen: boolean;
  newAisleName: string;
  onNewAisleNameChange: (value: string) => void;
  newAisleColor: string;
  onNewAisleColorChange: (color: string) => void;
  onSubmit: () => void;
  onOpen: () => void;
  onCancel: () => void;
}

// HOUP-225: swatch-by-key trick mirrors web page.tsx:1221-1223 — getAisleColor
// only resolves a color by looking it up on a `GroceryCustomAisle`-shaped
// object, so a throwaway one keyed `__<color>` stands in for each swatch.
export function customAisleSwatchDot(color: string): string {
  return getAisleColor(`__${color}`, [{ id: '', group_id: '', name: `__${color}`, color, sort_order: 0 }]).fill;
}

export function GroceriesAddAisleFooter({
  addAisleOpen,
  newAisleName,
  onNewAisleNameChange,
  newAisleColor,
  onNewAisleColorChange,
  onSubmit,
  onOpen,
  onCancel,
}: GroceriesAddAisleFooterProps) {
  return (
    <View className="mt-4">
      {addAisleOpen ? (
        <View className="gap-2.5">
          <View className="flex-row items-center gap-2">
            <Input
              autoFocus
              value={newAisleName}
              onChangeText={onNewAisleNameChange}
              placeholder="New aisle name"
              className="flex-1"
              onSubmitEditing={onSubmit}
            />
            <Button size="sm" onPress={onSubmit}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onPress={onCancel}>
              Cancel
            </Button>
          </View>
          <View className="flex-row items-center gap-2">
            <Text className="text-xs text-muted-foreground">Color:</Text>
            {CUSTOM_AISLE_COLOR_KEYS.map((key) => (
              <Pressable
                key={key}
                onPress={() => onNewAisleColorChange(key)}
                className={cn(
                  'h-5 w-5 rounded-full',
                  customAisleSwatchDot(key),
                  newAisleColor === key ? 'opacity-100' : 'opacity-40'
                )}
              />
            ))}
          </View>
        </View>
      ) : (
        <Pressable
          onPress={onOpen}
          className="flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-border px-3 py-1.5"
        >
          <Plus size={14} className="text-muted-foreground" />
          <Text className="text-sm text-muted-foreground">Add custom aisle</Text>
        </Pressable>
      )}
    </View>
  );
}
