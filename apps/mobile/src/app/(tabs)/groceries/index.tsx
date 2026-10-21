// HOUP-80: native Groceries — aisle-grouped shopping list + shelf-life library
// link. Faithful-but-focused port of apps/web/src/app/groceries/page.tsx:
// pulse strip, session tracking, suggest-re-add, per-aisle quick-add,
// select-mode bulk set-aisle/delete, add-custom-aisle. Reuses @homeup/core's
// groceries/session/library math and the groceryItems$ store verbatim — no
// core changes. Deferred per the approved plan: receipt upload/scan (Phase 3,
// HOUP-94). See the ticket's implementation-plan comment for the smaller
// trims (snooze presets only, bulk set-aisle+delete only, in-memory collapse
// state, plain substring search).
//
// HOUP-175 (absorbing the HOUP-95 deferral): items within an aisle now
// drag-reorder via packages/ui's `ReorderableList` (the HOUP-129 primitive),
// behind an explicit Reorder toggle mutually exclusive with Select — mirrors
// Setup's reorder mode since GroceryItemCard has the same competing
// swipe/tap/long-press gestures. `grouped` now sorts by `sort_order` (was
// silently ignoring it, sorting by name instead — audit finding) so a drag
// here is visible and persists. Cross-aisle drag-and-drop and dragging the
// aisle *header* itself (web's dnd-kit supports both) are not ported — aisle
// order stays adjustable via Settings > Groceries (also now drag-reorderable,
// HOUP-175 item 2).
//
// HOUP-207: browse path (Select mode included) now renders via `FlashList`,
// flattening aisle-header/item/quick-add rows into one array (`getItemType`
// per row kind) instead of ScrollView+.map() — real datasets (~107 items)
// no longer freeze on first paint. Reorder mode is UNCHANGED and stays on a
// plain `ScrollView` + per-aisle `ReorderableList`: that primitive's
// long-press gesture only claims the touch from a ScrollView ancestor (see
// reorderable-list.tsx's header comment), and never from a virtualized list,
// so the two modes are now two sibling top-level branches (FlashList vs
// ScrollView) instead of a per-aisle ternary inside one ScrollView. The lede,
// controls, session panel, suggest-re-add, and add-custom-aisle control are
// shared between both branches via `GroceriesListHeader`/`GroceriesAddAisleFooter`.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
// HOUP-318: per-group quick-add rows sit anywhere in the list, so the FlashList
// scrolls via the keyboard-aware scroll view (Costs precedent, HOUP-284).
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { use$ } from '@legendapp/state/react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import * as SecureStore from 'expo-secure-store';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
  ArrowUpDown,
  BookOpen,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SquareCheck,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react-native';
import {
  Text,
  ActionMenu,
  type ActionMenuAnchor,
  type ActionMenuItem,
  Button,
  Card,
  cn,
  GroceryGlyph,
  haptics,
  HeroLede,
  Input,
  ReorderableList,
  ScreenBackground,
  SectionSearchBar,
  toast,
} from '@homeup/ui';
import {
  AISLE_ORDER,
  CUSTOM_AISLE_COLOR_KEYS,
  countHave,
  countNeeded,
  createPendingActionTracker,
  getAisleColor,
  getAisleMeta,
  getRegionProvider,
  resolveItemDefaults,
  suggestReAdd,
  grocerySearchAddOptions,
  groceryAislesMatching,
  parseGroceryEntry,
  canonicalizeItemName,
  sortGroceriesFlat,
  DEFAULT_GROCERY_SORT_MODE,
  todayStr,
  isBoughtToday,
  ensureSession,
  updateSession,
  closeSession,
  effectiveSessionTotal,
  syncSession,
  getEnabledModules,
  isFeatureEnabled,
  fetchTodaySession,
  uploadReceipt,
  applyReceiptLearning,
  formatMoney,
  groceryItems$,
  loyaltyCards$,
  sortLoyaltyCards,
  learnItemPrice,
  MOTION_DURATIONS_MS,
  usePendingIds,
  useReconnectSync,
  useStoreHelpers,
  useStoreLoaded,
  type GroceryItem,
  type GrocerySession,
  type LoyaltyCard,
  type GrocerySortMode,
  type SuggestReAddItem,
  type GroceryDismissAction,
  type DocumentUploadInput,
  dialog,
} from '@homeup/core';
import { useFuzzySearch } from '@homeup/core/src/hooks/use-fuzzy-search';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { createUndoToastPresenter } from '@/lib/undo-toast';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { perfMark } from '@/lib/perf-log';
import { whyRender } from '@/lib/why-render';
import { useGroupTableRealtime } from '@/lib/use-group-table-realtime';
import { randomUUID } from '@/lib/uuid';
import { isFlagParamSet } from '@/lib/route-params';
import { useGroceryAux } from '@/features/groceries/use-grocery-aux';
import { GroceryItemCard } from '@/features/groceries/grocery-item-card';
import { GroceryItemFormSheet } from '@/features/groceries/grocery-item-form-sheet';
import { FinishShopSheet, ShopTrackingPill, TrackShopPrompt, type FinishReceiptSource } from '@/features/groceries/grocery-session-panel';
import { parseReceiptFile } from '@/features/groceries/grocery-receipt-parse';
import { pickFromCamera, pickFromLibrary, pickFromFiles, type PickedFile } from '@/components/documents/capture-flow';
import { ReAddSuggestions } from '@/features/groceries/re-add-suggestions';
import { useGroceryArchive } from '@/features/groceries/use-grocery-archive';
import { useSuggestDismiss } from '@/features/groceries/use-suggest-dismiss';
import { useGroceryUndo } from '@/features/groceries/use-grocery-undo';
import { SwipeHintCard } from '@/features/groceries/swipe-hint-card';
import { RewardsCardsSheet } from '@/features/groceries/rewards-cards-sheet';
import { BulkActionsSheet } from '@/features/groceries/bulk-actions-sheet';
import { BulkAssignSheet } from '@/features/groceries/bulk-assign-sheet';
import { GroceriesSearchAdd } from '@/features/groceries/search-add';
import {
  getCachedSession,
  invalidateSessionFetch,
  isFreshSessionFetch,
  setCachedSession,
  startSessionFetch,
} from '@/features/groceries/session-fetch-freshness';
import { groupFrameClass, type RowPos } from '@homeup/ui';

// HOUP-225: aisle-collapse state now persists across sessions (was
// in-memory-only) — mirrors web page.tsx's localStorage mirror, via
// expo-secure-store (the established local-pref store on native, see
// theme-context.tsx's header comment).
const COLLAPSED_AISLES_KEY = 'homeup-grocery-collapsed-aisles';

// HOUP-207: the browse-path flattened row union — one aisle produces a
// header row, its (possibly empty) item rows, then an optional quick-add
// trailer row (omitted in Select mode, matching the pre-FlashList behavior).
// HOUP-225: header row now also carries the bought/buyable ratio +
// custom-aisle delete affordance (web page.tsx).
type GroceryRow =
  | {
      kind: 'aisle-header';
      id: string;
      aisleKey: string;
      label: string;
      icon: string;
      count: number;
      ratioText: string | null;
      subtotalText: string | null;
      isCustom: boolean;
      collapsed: boolean;
    }
  | { kind: 'item'; id: string; item: GroceryItem; pos: RowPos }
  | { kind: 'quick-add'; id: string; aisleKey: string; label: string }
  // HOUP-317: One list's tier boundary — before the first non-"needed" row.
  // Takes `groupFrameClass`'s base frame like an item row (not a bare label
  // like `aisle-header`) so it shares the card with its neighbours.
  | { kind: 'tier-label'; id: string; pos: RowPos };

// HOUP-285: how long a grocery_items/grocery_sessions realtime echo
// suppresses the session-cost sync effect below — see that effect's comment.
const REMOTE_ECHO_WINDOW_MS = 1500;

// HOUP-207: reproduces the original ScrollView's `gap-2` (header→content,
// content→quick-add) and `gap-4` (between aisle blocks) rhythm now that rows
// are flattened with no wrapping `View`s to carry gap spacing.
function groceryRowSpacing(prev: GroceryRow | undefined, current: GroceryRow): string | undefined {
  if (!prev) return undefined;
  if (current.kind === 'aisle-header') return 'mt-4';
  if (prev.kind === 'aisle-header') return 'mt-2';
  if (current.kind === 'quick-add') return 'mt-2';
  // HOUP-317: 'tier-label' falls through to `undefined` on purpose — a zero
  // top margin is exactly what keeps it in the same continuous card as its
  // neighbours (a margin here would visually split the card in two).
  return undefined;
}

interface GroceriesListHeaderProps {
  itemsCount: number;
  neededCount: number;
  caption: string | undefined;
  staplesAvailable: boolean;
  onSeedStaples: () => void;
  modeActive: boolean;
  onExitMode: () => void;
  onOpenMore: (anchor: ActionMenuAnchor) => void;
  onOpenView: (anchor: ActionMenuAnchor) => void;
  viewFiltered: boolean;
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
function MenuIconButton({
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
function GroceriesListHeader({
  itemsCount,
  neededCount,
  caption,
  staplesAvailable,
  onSeedStaples,
  modeActive,
  onExitMode,
  onOpenMore,
  onOpenView,
  viewFiltered,
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
          {/* HOUP-317's By aisle / One list and "Only needed", folded into one
              menu; the dot says "Only needed" is on (it hides rows). */}
          <MenuIconButton label="List view options" onOpen={onOpenView} dot={viewFiltered}>
            <SlidersHorizontal size={16} className="text-foreground" />
          </MenuIconButton>
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
    </View>
  );
}

interface GroceriesTripSummaryProps {
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
function GroceriesTripSummary({ estTotal, buyableCount, unpricedCount, showTrack, onTrack, boughtStatusCount, onResetBought }: GroceriesTripSummaryProps) {
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

interface GroceriesCollapsedBarProps {
  topInset: number;
  neededCount: number;
  caption: string | undefined;
  viewFiltered: boolean;
  onSearch: () => void;
  onOpenCards: () => void;
  onOpenView: (anchor: ActionMenuAnchor) => void;
  onAddItem: () => void;
}

/** The slim bar that takes over once the lede has scrolled away, so the list
 *  gets the screen while you shop: the count, then search (back to the top),
 *  Rewards cards, view options and Add. */
function GroceriesCollapsedBar({ topInset, neededCount, caption, viewFiltered, onSearch, onOpenCards, onOpenView, onAddItem }: GroceriesCollapsedBarProps) {
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
          <Text numberOfLines={1} className="text-title text-muted-foreground">
            to buy
          </Text>
          {caption != null && (
            <Text numberOfLines={1} className="text-caption text-muted-foreground">
              {caption}
            </Text>
          )}
        </View>
        <Button size="icon-sm" variant="outline" onPress={onSearch} accessibilityLabel="Search or add">
          <Search size={16} className="text-foreground" />
        </Button>
        <Button size="icon-sm" variant="outline" onPress={onOpenCards} accessibilityLabel="Rewards cards">
          <WalletCards size={16} className="text-foreground" />
        </Button>
        <MenuIconButton label="List view options" onOpen={onOpenView} dot={viewFiltered}>
          <SlidersHorizontal size={16} className="text-foreground" />
        </MenuIconButton>
        <Button size="icon-sm" onPress={onAddItem} accessibilityLabel="Add item" className="rounded-full">
          <Plus size={16} className="text-primary-foreground" />
        </Button>
      </View>
    </Animated.View>
  );
}

interface GroceriesAddAisleFooterProps {
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
function customAisleSwatchDot(color: string): string {
  return getAisleColor(`__${color}`, [{ id: '', group_id: '', name: `__${color}`, color, sort_order: 0 }]).fill;
}

function GroceriesAddAisleFooter({
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

export default function GroceriesSectionScreen() {
  // HOUP-240: fires on every mount, including react-freeze re-mounting this
  // screen's subtree on unfreeze — the render itself, not the effects below,
  // is the first thing to attribute against the tab-press mark.
  perfMark('groceries:render');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dataCache = useDataCache();
  const { group, currentUserId, memberProfiles, userSettings, loading: cacheLoading } = dataCache;
  whyRender('groceries', { dataCache, group, currentUserId, memberProfiles, userSettings, cacheLoading });

  const items$ = groceryItems$(group?.id);
  useReconnectSync(items$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(items$, currentUserId);
  const storeLoaded = useStoreLoaded(items$);
  const items = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted)
  );
  whyRender('groceries:stores', { items$, items, storeLoaded });

  // HOUP-245: tick-off linger — a disposition change away from 'needed'
  // (bought/have) doesn't drop the row out of the "Needed only" filter until
  // this grace window elapses (re-swiping back to 'needed' within the
  // window cancels cleanly). Only the per-aisle "Needed only" cut in
  // `flatData`/`passesHideFilter` below reads it; the buyable/estimate totals
  // stay on the item's real status.
  const groceryLingerTracker = React.useMemo(() => createPendingActionTracker(), []);
  const pendingGroceryIds = usePendingIds(groceryLingerTracker);

  // Read through a ref so patchGroceryItem stays stable and rows don't re-render on every change.
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const patchGroceryItem = React.useCallback(
    (id: string, patch: Partial<GroceryItem>) => {
      // HA: read the row before patching (Legend patches mutate it in place).
      const list = itemsRef.current;
      const before = patch.status ? list.find((i) => i.id === id) : undefined;
      if (before && patch.status && before.status !== patch.status) {
        const cleared = patch.status === 'bought' && before.status === 'needed' && !list.some((i) => i.id !== id && i.status === 'needed');
        if (cleared) haptics.celebrate();
        else if (patch.status === 'bought') haptics.success();
        else if (patch.status === 'have') haptics.tick();
        else haptics.select();
      }
      patchRow(id, patch);
      if (patch.status === 'needed') groceryLingerTracker.cancel(id);
      else if (patch.status === 'bought' || patch.status === 'have') groceryLingerTracker.schedule(id, () => {});
    },
    [patchRow, groceryLingerTracker]
  );

  // HOUP-245/HOUP-224: two distinct undo-pill presenters, coalescing rapid
  // actions of the SAME kind into one pill with a running count. Archive
  // teaches the shared library on the undo-toast's expiry (deferred so an
  // undone archive never teaches from a row the user kept); Delete never
  // does — this is the split the ticket asked for, replacing the old single
  // `handleDelete` that always learned regardless of which action fired it.
  // Archive's presenter lives in `useGroceryArchive` (shared with the Home
  // widget's suggestions). Reads `patchRow` through a ref since the presenter
  // is created once but `restore` fires later.
  const patchRowRef = React.useRef(patchRow);
  patchRowRef.current = patchRow;
  const archiveItem = useGroceryArchive(group?.id, patchRow, softDeleteRow);
  const groceryTrueDeleteUndo = React.useMemo(
    () =>
      createUndoToastPresenter<GroceryItem>({
        message: (count) => (count === 1 ? 'Item deleted' : `${count} items deleted`),
        restore: (item) => patchRowRef.current(item.id, { deleted: false }),
        // No onExpire: Delete is destructive and never teaches the library
        // (distinct from Archive above — mirrors web page.tsx's
        // handleRequestDelete/handleArchive split).
      }),
    []
  );

  const { customAisles, library, libMap, priceFor, refresh: refreshAux } = useGroceryAux(group?.id);
  whyRender('groceries:aux', { customAisles, library, libMap, priceFor, refreshAux });

  const [session, setSession] = React.useState<GrocerySession | null>(null);
  // False until today's session is known (cache or fetch): before then a null
  // session only means "not read yet", and the Track ask flashed up and away.
  const [sessionKnown, setSessionKnown] = React.useState(false);
  // The Track ask's answer while its save is in flight: the ask hides (and the
  // pill shows, for Track) on the tap, not after the round trip.
  const [pendingTracking, setPendingTracking] = React.useState<'on' | 'skipped' | null>(null);
  const sessionSyncRef = React.useRef<string>('');
  // Timestamp (ms) of the last grocery_items/grocery_sessions realtime echo,
  // 0 = none yet. A bounded TTL, not a consume-once flag (see the sync
  // effect below for why the earlier boolean version silently dropped
  // genuine local tally changes).
  const remoteUpdateRef = React.useRef(0);
  const sessionFetchVersionRef = React.useRef(0);
  const [search, setSearch] = React.useState('');
  const [hideNonNeeded, setHideNonNeeded] = React.useState(false);
  // While a query is active the list shows every match: "Needed only" would
  // otherwise hide a have/bought item you searched for with no way to tell.
  const searching = search.trim().length > 0;
  const filterNeeded = hideNonNeeded && !searching;
  const [sortMode, setSortMode] = React.useState<GrocerySortMode>(DEFAULT_GROCERY_SORT_MODE);
  // HOUP-317: stashed "Only needed" value while in One list, restored on the
  // way back to By aisle. Null on a cold load into flat (nothing to restore).
  const hideNonNeededStashRef = React.useRef<boolean | null>(null);
  const [collapsedAisles, setCollapsedAisles] = React.useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<GroceryItem | undefined>();
  const [defaultAisle, setDefaultAisle] = React.useState<string | undefined>();
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  // HOUP-175 (HOUP-95 deferral): drag-to-reorder within an aisle, mutually
  // exclusive with Select mode — mirrors HOUP-129's Setup reorder toggle.
  const [reorderMode, setReorderMode] = React.useState(false);
  // Compact header menus (More, List view options), anchored to their buttons.
  const [moreAnchor, setMoreAnchor] = React.useState<ActionMenuAnchor | null>(null);
  const [viewAnchor, setViewAnchor] = React.useState<ActionMenuAnchor | null>(null);
  // Collapse on scroll: once the lede + search block has scrolled off, the
  // slim GroceriesCollapsedBar takes over. `headBottomRef` is that block's
  // bottom inside the list header; state flips only when the side changes.
  const listRef = React.useRef<React.ElementRef<typeof FlashList<GroceryRow>>>(null);
  const headBottomRef = React.useRef(0);
  const [collapsed, setCollapsed] = React.useState(false);
  const collapsedRef = React.useRef(false);
  const onListScroll = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = headBottomRef.current > 0 && e.nativeEvent.contentOffset.y > headBottomRef.current;
    if (next !== collapsedRef.current) {
      collapsedRef.current = next;
      setCollapsed(next);
    }
  }, []);
  const [bulkSheetOpen, setBulkSheetOpen] = React.useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = React.useState(false);

  // Rewards cards: local-first like the list itself, so a card still opens
  // at the checkout with no signal.
  const cards$ = loyaltyCards$(group?.id);
  useReconnectSync(cards$);
  const { writeRow: writeCard, softDeleteRow: softDeleteCard } = useStoreHelpers(cards$, currentUserId);
  const cards = use$(() =>
    sortLoyaltyCards(Object.values(cards$.get() ?? {}).filter((c): c is LoyaltyCard => !!c && !c.deleted))
  );
  const [cardsOpen, setCardsOpen] = React.useState(false);
  const [addAisleOpen, setAddAisleOpen] = React.useState(false);
  const [newAisleName, setNewAisleName] = React.useState('');
  const [newAisleColor, setNewAisleColor] = React.useState<string>(CUSTOM_AISLE_COLOR_KEYS[0]);
  const [quickAddDrafts, setQuickAddDrafts] = React.useState<Record<string, string>>({});
  const [receiptBusy, setReceiptBusy] = React.useState(false);
  const [receiptError, setReceiptError] = React.useState<string | null>(null);
  // The finish sheet (Done on the shop pill).
  const [finishOpen, setFinishOpen] = React.useState(false);

  // HOUP-225: hydrate collapsed-aisle state once on mount — was in-memory
  // only, resetting every time the screen remounted (mirrors web page.tsx's
  // localStorage-backed loadCollapsedAisles, via expo-secure-store here).
  const collapsedHydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (collapsedHydratedRef.current) return;
    collapsedHydratedRef.current = true;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(COLLAPSED_AISLES_KEY);
        if (raw) setCollapsedAisles(new Set(JSON.parse(raw)));
      } catch {
        // best effort — falls back to the in-memory default
      }
    })();
  }, []);

  // HOUP-317: list view mode syncs via user_settings.grocery_sort_mode —
  // mirrors costs/index.tsx's costs_period hydration (native has no
  // localStorage mirror, so the DB is the only source). A hydrated 'flat'
  // couples "Only needed" on too, same as onSortModeChange, but with no
  // stash — a cold load has no prior aisle-mode value, so returning to By
  // aisle lands on `false`, today's default.
  const sortModeHydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (cacheLoading || sortModeHydratedRef.current) return;
    sortModeHydratedRef.current = true;
    const dbMode = userSettings?.grocery_sort_mode;
    if (dbMode === 'aisle' || dbMode === 'flat') {
      setSortMode(dbMode);
      if (dbMode === 'flat') setHideNonNeeded(true);
    }
  }, [cacheLoading, userSettings]);

  const persistSortMode = React.useCallback(async (mode: GrocerySortMode) => {
    try {
      const supabase = getCurrentSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, grocery_sort_mode: mode, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    } catch {
      // Offline — local state already reflects the change; the next
      // successful write will persist it (AC 9: reaches the DB "next write").
    }
  }, []);

  // HOUP-317: switching to One list stashes the current "Only needed" and
  // forces it on; switching back restores the stash. Also exits Reorder —
  // One list has no drag-to-reorder.
  const handleSortModeChange = React.useCallback((mode: GrocerySortMode) => {
    if (mode === sortMode) return;
    haptics.select();
    setSortMode(mode);
    void persistSortMode(mode);
    if (mode === 'flat') {
      hideNonNeededStashRef.current = hideNonNeeded;
      setHideNonNeeded(true);
      setReorderMode(false);
    } else {
      setHideNonNeeded(hideNonNeededStashRef.current ?? false);
      hideNonNeededStashRef.current = null;
    }
  }, [sortMode, hideNonNeeded, persistSortMode]);

  // Session fetch (once per group); realtime below keeps the mounted screen in
  // step with other clients while actions still re-set local state immediately.
  React.useEffect(() => {
    if (!group) return;
    perfMark('groceries:effect:sessionFetch:start');
    let cancelled = false;
    const fetchVersion = startSessionFetch(sessionFetchVersionRef);
    const today = todayStr();
    const cached = getCachedSession(group.id, today);
    if (cached !== undefined) {
      setSession(cached);
      setSessionKnown(true);
    }
    (async () => {
      const supabase = getCurrentSupabaseClient();
      const s = await fetchTodaySession(supabase, group.id);
      perfMark('groceries:effect:sessionFetch:resolved');
      if (!cancelled && isFreshSessionFetch(sessionFetchVersionRef, fetchVersion)) {
        setSession(s);
        setSessionKnown(true);
        setCachedSession(group.id, today, s);
      }
    })();
    return () => {
      cancelled = true;
      invalidateSessionFetch(sessionFetchVersionRef);
    };
  }, [group]);

  // End-of-day auto-convert: a "Got it" item not bought TODAY silently
  // becomes "Have it" (mirrors web page.tsx's mount effect).
  const autoConverted = React.useRef(false);
  React.useEffect(() => {
    if (!storeLoaded || autoConverted.current) return;
    perfMark('groceries:effect:autoConvert', `items=${items.length}`);
    autoConverted.current = true;
    const today = todayStr();
    for (const item of items) {
      if (item.status === 'bought' && !isBoughtToday(item, today)) {
        patchRow(item.id, { status: 'have', status_changed_at: new Date().toISOString() });
      }
    }
  }, [storeLoaded, items, patchRow]);

  // Session-cost sync: only local cart edits write the derived session/cost
  // line. Realtime echoes update screen state; a remote echo suppresses the
  // sync for a short window (REMOTE_ECHO_WINDOW_MS) so a remote peer's
  // grocery_items write — which the Legend-State store may apply a tick
  // after the realtime message arrives — doesn't get raced by this client
  // recomputing and writing its own `summed` before that peer's own sync
  // lands (HOUP-241).
  //
  // HOUP-285: this used to be a consume-once boolean, cleared only on a run
  // that found a mismatch — which meant a stale flag from an unrelated
  // earlier realtime event (e.g. this session's own prior sync echoing back
  // over `grocery_sessions`) could sit set indefinitely across any number of
  // "no mismatch" runs, then wrongly suppress a *later, unrelated* genuine
  // local tally change the next time one happened to land while it was still
  // set — silently dropping a bought item's price from the running total
  // until some other unrelated effect dependency happened to fire again. A
  // bounded time window replaces the flag: it decays on its own, so it can
  // no longer outlive the short async gap it exists to cover.
  React.useEffect(() => {
    if (!session || !group || session.tracking !== 'on' || session.closed_at) return;
    perfMark('groceries:effect:sessionCostSync:start', `items=${items.length}`);
    const today = todayStr();
    const boughtToday = items.filter((i) => isBoughtToday(i, today));
    const summed = boughtToday.reduce((sum, i) => sum + (i.last_price ?? i.price_cents ?? priceFor(i.name) ?? 0), 0);
    if (summed === session.summed_total_cents) return;
    if (Date.now() - remoteUpdateRef.current < REMOTE_ECHO_WINDOW_MS) return;
    const sig = `${session.id}|${summed}|${session.override_total_cents}|${session.receipt_total_cents}|${session.retailer}|${session.receipt_path}`;
    if (sessionSyncRef.current === sig) return;
    const prevSig = sessionSyncRef.current;
    sessionSyncRef.current = sig;
    (async () => {
      const supabase = getCurrentSupabaseClient();
      try {
        // Modules: the trip's cost line needs costs and groceries (module-features.ts).
        const writeCostLine = isFeatureEnabled('costs.from-groceries', getEnabledModules());
        const updated = await syncSession(supabase, session, group.id, summed, writeCostLine);
        setSession(updated);
        setCachedSession(group.id, todayStr(), updated);
      } catch (err) {
        console.error('grocery session sync failed:', err);
        if (sessionSyncRef.current === sig) sessionSyncRef.current = prevSig;
      }
    })();
  }, [items, session, group, priceFor]);

  // The Legend-State store owns grocery_items data sync; this subscription is
  // only an echo marker for the derived session-cost effect above.
  useGroupTableRealtime({
    table: 'grocery_items',
    groupId: group?.id,
    onChange: () => {
      remoteUpdateRef.current = Date.now();
    },
  });

  useGroupTableRealtime({
    table: 'grocery_sessions',
    groupId: group?.id,
    onChange: (payload) => {
      if (payload.eventType === 'DELETE') {
        const old = payload.old as unknown as { id?: string };
        if (old.id === session?.id) {
          invalidateSessionFetch(sessionFetchVersionRef);
          setSession(null);
          if (group) setCachedSession(group.id, todayStr(), null);
          remoteUpdateRef.current = Date.now();
        }
      }

      if (payload.eventType !== 'DELETE') {
        const next = payload.new as unknown as GrocerySession;
        if (next.session_date !== todayStr()) return;
        invalidateSessionFetch(sessionFetchVersionRef);
        setSession(next as GrocerySession);
        if (group) setCachedSession(group.id, todayStr(), next as GrocerySession);
        remoteUpdateRef.current = Date.now();
      }
    },
  });

  const boughtTodayItems = React.useMemo(() => items.filter((i) => isBoughtToday(i)), [items]);
  const boughtCount = boughtTodayItems.length;
  // "Reset bought" (web page.tsx's `bought`/`countBought`) is scoped to
  // status, not to today — distinct from `boughtCount` above (today-only,
  // drives the lede caption + session panel).
  const boughtStatusCount = React.useMemo(() => items.filter((i) => i.status === 'bought').length, [items]);
  // HOUP-285: rescue via the library price the same way the running total
  // does (line ~528) and web does (page.tsx effectivePriceCents) — without
  // priceFor here, a library-priced item bought with no stored price/last
  // price (e.g. via the Home widget, which never passes priceCents) reads
  // "unpriced" in the caption even though its price is already counted.
  const unpricedCount = boughtTodayItems.filter((i) => (i.last_price ?? i.price_cents ?? priceFor(i.name)) == null).length;
  // HOUP-285: the no-session gate's context line needs a live estimate even
  // before a session exists to persist a summed_total_cents into — mirrors
  // the same reduce the sync effect uses (line ~528) and web's live
  // `sessionSum` (page.tsx), rather than reading the (possibly absent)
  // persisted session total.
  const sessionSummedCents = React.useMemo(
    () => boughtTodayItems.reduce((sum, i) => sum + (i.last_price ?? i.price_cents ?? priceFor(i.name) ?? 0), 0),
    [boughtTodayItems, priceFor]
  );

  // Lede counts (Hearth H1/H6: one display-weight lede, value-first fragments) —
  // mirrors web page.tsx's `needed`/`haveCount`.
  const neededCount = React.useMemo(() => countNeeded(items), [items]);
  const haveCount = React.useMemo(() => countHave(items), [items]);

  // Re-add suggestions: 'have' items past shelf life.
  const suggestions = React.useMemo(() => suggestReAdd(items, libMap), [items, libMap]);

  // Effective price = the item's own price, else the library's typical price
  // for its name (mirrors web page.tsx's effectivePriceCents/sumEstimate).
  const effectivePriceCents = React.useCallback(
    (item: GroceryItem) => item.price_cents ?? priceFor(item.name),
    [priceFor]
  );
  const sumEstimate = React.useCallback(
    (list: GroceryItem[]) => list.reduce((sum, i) => sum + (effectivePriceCents(i) ?? 0), 0),
    [effectivePriceCents]
  );

  // HOUP-225: fuzzy search (name + notes) replaces the plain `includes` scan —
  // matches web page.tsx's `searchedItems` (via `useFuzzySearch`) exactly,
  // including that it is NOT hideNonNeeded-filtered — that cut happens below,
  // per-aisle, so "no items match your search" can never be confused with
  // "everything matched is hidden by Needed only".
  // "2 milk" searches for "milk"; the quantity rides along to the add panel.
  const searchEntry = React.useMemo(() => parseGroceryEntry(search), [search]);
  const fuzzyItems = useFuzzySearch(items, searchEntry.name, ['name', 'notes']);
  // Naming an aisle ("dairy") also lists everything in it.
  const searchedItems = React.useMemo(() => {
    const aisles = groceryAislesMatching(searchEntry.name, customAisles);
    if (aisles.length === 0) return fuzzyItems;
    const seen = new Set(fuzzyItems.map((i) => i.id));
    return [...fuzzyItems, ...items.filter((i) => aisles.includes(i.aisle) && !seen.has(i.id))];
  }, [fuzzyItems, items, searchEntry.name, customAisles]);

  // HOUP-175: was sorting by status-rank then name, silently ignoring the
  // user's own drag order and never reading `sort_order` at all (audit
  // finding). Mirrors web page.tsx:114's tiebreaker exactly so a drag here
  // persists visibly instead of being fought by a status re-sort on re-render.
  const grouped = React.useMemo(() => {
    const map = new Map<string, GroceryItem[]>();
    for (const item of searchedItems) {
      if (!map.has(item.aisle)) map.set(item.aisle, []);
      map.get(item.aisle)!.push(item);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
    }
    return map;
  }, [searchedItems]);

  // Search add options: offer the query (aisle guessed) and matching library
  // entries that aren't on the list, below whatever on-list items matched.
  const searchAdd = React.useMemo(() => grocerySearchAddOptions(items, library, search, customAisles), [items, library, search, customAisles]);

  // FLUX-65: aisle order syncs via user_settings.grocery_aisle_order (mobile's
  // own settings panel writes it) — DB order wins, else the code default.
  const aisleOrder = React.useMemo(() => {
    const stored = userSettings?.grocery_aisle_order;
    if (Array.isArray(stored) && stored.length) {
      const extra = AISLE_ORDER.filter((a) => !stored.includes(a));
      return [...stored, ...extra];
    }
    return AISLE_ORDER as string[];
  }, [userSettings]);

  // HOUP-225: since `grouped` is now search-only (see searchedItems above),
  // an aisle with nothing left to buy under "Needed only" must be dropped
  // here explicitly — mirrors web page.tsx:755-764's `hideNonNeeded ?
  // list.some(needed...) : true`.
  const passesHideFilter = React.useCallback(
    (aisleKey: string) => {
      if (!filterNeeded) return true;
      const list = grouped.get(aisleKey);
      if (!list?.length) return true;
      return list.some((i) => i.status === 'needed' || pendingGroceryIds.has(i.id));
    },
    [grouped, filterNeeded, pendingGroceryIds]
  );

  const orderedAisleKeys = React.useMemo(() => {
    const keys = new Set(grouped.keys());
    const known = aisleOrder.filter((a) => keys.has(a) && passesHideFilter(a));
    const customNames = (customAisles ?? []).map((a) => a.name).filter((n) => keys.has(n) && passesHideFilter(n));
    // Empty custom aisles stay visible so users have a place to add items;
    // built-in empties, and anything under an active filter, still drop out
    // (matches web page.tsx:734-743).
    const showEmptyCustom = !search.trim() && !hideNonNeeded;
    const emptyCustomNames = showEmptyCustom
      ? (customAisles ?? []).map((a) => a.name).filter((n) => !keys.has(n))
      : [];
    const other = [...keys].filter((k) => !known.includes(k) && !customNames.includes(k) && passesHideFilter(k));
    return [...known, ...customNames, ...emptyCustomNames, ...other];
  }, [grouped, customAisles, aisleOrder, search, hideNonNeeded, passesHideFilter]);

  // Items you'll actually buy (Needed + Got it) — "Have it" is excluded from
  // totals/progress, matching web page.tsx's buyableItems.
  const buyableItems = React.useMemo(() => items.filter((i) => i.status !== 'have'), [items]);
  const estTotal = sumEstimate(buyableItems);
  const pulseUnpricedCount = React.useMemo(
    () => buyableItems.filter((i) => effectivePriceCents(i) == null).length,
    [buyableItems, effectivePriceCents]
  );

  const openAdd = React.useCallback((aisle?: string) => {
    setEditingItem(undefined);
    setDefaultAisle(aisle);
    setFormOpen(true);
  }, []);

  // HOUP-110: the widget's Groceries "+" deep-links here with ?add=1
  // (RemoteViews has no text input, so it can only hand off to this screen's
  // own add flow).
  const addParam = useLocalSearchParams<{ add?: string }>().add;
  const addRequested = isFlagParamSet(addParam);
  // Cleared once consumed, same as tasks/index.tsx: the screen stays mounted
  // between visits, so an unchanged ?add=1 would not reopen the form.
  React.useEffect(() => {
    if (!addRequested) return;
    openAdd();
    router.setParams({ add: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequested]);

  const openEdit = (item: GroceryItem) => {
    setEditingItem(item);
    setFormOpen(true);
  };

  // HOUP-139/HOUP-245: no blocking confirm — remove immediately (soft-delete,
  // so it's a clean local un-hide) and offer a coalescing Undo pill instead.
  // Learning the item into the library (see `useGroceryArchive`) is
  // deferred to the tracker's expiry so an undone archive never teaches the
  // library from a row the user kept. This is the edit sheet's "Archive"
  // button (grocery-item-form-sheet.tsx) and the row overflow menu's
  // "Archive" item (HOUP-224) — both learn-to-library, neither confirms.
  const handleArchive = React.useCallback(
    (item: GroceryItem) => {
      setFormOpen(false);
      archiveItem(item);
    },
    [archiveItem]
  );
  const groceryUndo = useGroceryUndo(patchRow);
  const suggestDismiss = useSuggestDismiss({ hide: groceryUndo.hide, archive: archiveItem });

  // HOUP-224: the row overflow menu's "Delete" — distinct from Archive above,
  // confirmed inside the menu (dialog.alert) before this fires, and never
  // learns to the library (mirrors web page.tsx's handleRequestDelete).
  const handleRequestDelete = React.useCallback(
    (item: GroceryItem) => {
      softDeleteRow(item.id);
      setFormOpen(false);
      groceryTrueDeleteUndo.addAndShow(item);
    },
    [softDeleteRow, groceryTrueDeleteUndo]
  );

  // HOUP-224: row-level price chip's "teach the shared library" side effect
  // (debounced in the card itself so a drag's continuous onChange stream
  // doesn't fire one upsert per tick).
  const handleLearnPrice = React.useCallback(
    (name: string, cents: number) => {
      if (!group) return;
      void learnItemPrice(getCurrentSupabaseClient(), group.id, name, cents);
    },
    [group]
  );

  const quickAdd = React.useCallback(
    (name: string, aisle: string, entry?: { quantity: number | null; unit: string | null }) => {
      const trimmed = name.trim();
      if (!trimmed || !group) return;
      const defaults = resolveItemDefaults(trimmed, libMap);
      // FLUX-65: prefill the aisle's configured default unit, if any. The typed
      // aisle is authoritative — it must never be overridden by the library's
      // suggested aisle (matches web page.tsx:580-618).
      const defaultUnit = userSettings?.grocery_aisle_units?.[aisle] ?? null;
      const now = new Date().toISOString();
      writeRow({
        id: randomUUID(),
        group_id: group.id,
        name: trimmed,
        aisle,
        quantity: entry?.quantity ?? null,
        unit: entry?.unit ?? defaultUnit,
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
        shelf_life_days: defaults.days ?? null,
        price_cents: defaults.priceCents ?? null,
        is_essential: false,
        recipe_note: null,
        recipe_source_id: null,
        re_add_snoozed_until: null,
        re_add_dismissed_at: null,
      });
      haptics.commit();
      setQuickAddDrafts((d) => ({ ...d, [aisle]: '' }));
    },
    [group, libMap, userSettings, currentUserId, writeRow]
  );

  // Return in the search bar adds what the panel offers first: an exact
  // library entry (keeps its learned details), else the typed name.
  const submitSearchAdd = React.useCallback(() => {
    const exact = searchAdd.librarySuggestions.find((o) => canonicalizeItemName(o.item_name) === canonicalizeItemName(searchEntry.name));
    if (exact) quickAdd(exact.item_name, exact.aisle ?? 'other', searchAdd);
    else if (searchAdd.addName) quickAdd(searchAdd.addName, searchAdd.addAisle, searchAdd);
    else return;
    setSearch('');
  }, [searchAdd, searchEntry.name, quickAdd]);

  // Starter staples (web page.tsx:642-681): seeds the region's staple
  // templates, deduped by template_key against what's already on the list —
  // the empty-state CTA above.
  const seedStaples = React.useCallback(() => {
    if (!group) return;
    const region = getRegionProvider(group.region);
    if (!region.groceryStaples.length) return;
    const existingKeys = new Set(items.map((i) => i.template_key).filter(Boolean));
    const now = new Date().toISOString();
    region.groceryStaples
      .filter((s) => !existingKeys.has(s.template_key))
      .forEach((s, idx) =>
        writeRow({
          id: randomUUID(),
          group_id: group.id,
          name: s.name,
          aisle: s.aisle,
          quantity: s.quantity,
          unit: s.unit,
          status: 'needed',
          notes: null,
          assigned_to: null,
          private: false,
          template_key: s.template_key,
          sort_order: idx,
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
        })
      );
  }, [group, items, currentUserId, writeRow]);

  // Reset bought (web page.tsx resetBought): moves every "Got it" item back
  // to Needed. Runs at once with an Undo pill, which replaced the old confirm
  // dialog that guarded against fat-fingering it next to Done shopping.
  const resetBought = React.useCallback(() => {
    groceryUndo.resetBought(items.filter((i) => i.status === 'bought'));
  }, [items, groceryUndo]);

  // HOUP-175: reindex sort_order 0..n over the dropped aisle's own items only
  // (matches web's arrayMove(...).map((it, idx) => ({...it, sort_order: idx}))
  // at page.tsx:450-451) — never touches other aisles' sort_order.
  const reorderAisleItems = (aisleKey: string, nextOrderedIds: string[]) => {
    nextOrderedIds.forEach((id, index) => patchRow(id, { sort_order: index }));
  };

  const toggleSelect = React.useCallback(
    (id: string) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const bulkDelete = () => {
    dialog.alert('Remove selected items?', `${selectedIds.size} item(s) will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          selectedIds.forEach((id) => softDeleteRow(id));
          exitSelectMode();
        },
      },
    ]);
  };

  const bulkSetAisle = (aisle: string) => {
    selectedIds.forEach((id) => patchRow(id, { aisle }));
    setBulkSheetOpen(false);
    exitSelectMode();
  };

  // "Assign to" bulk action (web page.tsx:1293-1311's PopMenu) — the bulk
  // bar's second menu, alongside "Set aisle".
  const bulkAssign = (userId: string | null) => {
    selectedIds.forEach((id) => patchRow(id, { assigned_to: userId }));
    setBulkAssignOpen(false);
    exitSelectMode();
  };

  const addCustomAisle = async () => {
    const name = newAisleName.trim();
    if (!name || !group) return;
    const supabase = getCurrentSupabaseClient();
    await supabase
      .from('grocery_aisles')
      .insert({ group_id: group.id, name, color: newAisleColor, sort_order: customAisles?.length ?? 0 });
    refreshAux();
    setNewAisleName('');
    setNewAisleColor(CUSTOM_AISLE_COLOR_KEYS[(customAisles?.length ?? 0) % CUSTOM_AISLE_COLOR_KEYS.length]);
    setAddAisleOpen(false);
  };

  // Custom-aisle delete (web page.tsx:505-514): moves the aisle's items to
  // "Other" first, then removes the aisle row itself.
  const deleteCustomAisle = React.useCallback(
    (aisleName: string) => {
      const aisle = (customAisles ?? []).find((a) => a.name === aisleName);
      if (!aisle) return;
      dialog.alert(`Delete "${aisleName}"?`, 'Items in this aisle will be moved to Other.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            items.filter((i) => i.aisle === aisleName).forEach((i) => patchRow(i.id, { aisle: 'other' }));
            void (async () => {
              await getCurrentSupabaseClient().from('grocery_aisles').delete().eq('id', aisle.id);
              refreshAux();
            })();
          },
        },
      ]);
    },
    [customAisles, items, patchRow, refreshAux]
  );

  // HOUP-207: browse-path flattening — one row array feeding FlashList,
  // matching HOUP-205/206's aisle/room-header + row union pattern. Forced
  // empty when there are literally zero items (mirrors the old top-level
  // `items.length === 0` gate) even though some empty custom aisles could
  // otherwise still produce header-only rows.
  const flatData = React.useMemo<GroceryRow[]>(() => {
    if (items.length === 0) return [];

    // HOUP-317: One list — a sibling flat path, not conditionals threaded
    // through the aisle branch below. Same search + "Only needed" filter
    // contract as the aisle view (including the pendingGroceryIds grace
    // window), then the shared essentials-first/A-to-Z comparator. `pos` is
    // computed across the WHOLE flat array (including the tier label) so
    // only the true first/last rows round — the single continuous card.
    if (sortMode === 'flat') {
      const visible = filterNeeded
        ? searchedItems.filter((i) => i.status === 'needed' || pendingGroceryIds.has(i.id))
        : searchedItems;
      const sorted = sortGroceriesFlat(visible);
      const tailStart = sorted.findIndex((i) => i.status !== 'needed'); // -1 = no tail
      const rowCount = sorted.length + (tailStart !== -1 ? 1 : 0);
      const rows: GroceryRow[] = [];
      let rowIndex = 0;
      const nextPos = (): RowPos => {
        const pos: RowPos = rowCount === 1 ? 'only' : rowIndex === 0 ? 'first' : rowIndex === rowCount - 1 ? 'last' : 'middle';
        rowIndex++;
        return pos;
      };
      // Row ids are prefixed so no key is shared with the aisle view. FlashList
      // v2 keeps the first visible row's key pinned on screen across data
      // changes (maintainVisibleContentPosition), so a shared item id made a
      // view switch scroll to wherever that item lands in the other layout.
      // With no shared key the scroll offset holds and the new view unfolds
      // below the controls.
      sorted.forEach((item, i) => {
        if (i === tailStart) rows.push({ kind: 'tier-label', id: 'flat:tier-label', pos: nextPos() });
        rows.push({ kind: 'item', id: `flat:${item.id}`, item, pos: nextPos() });
      });
      return rows;
    }

    const rows: GroceryRow[] = [];
    for (const aisleKey of orderedAisleKeys) {
      const aisleItems = grouped.get(aisleKey) ?? [];
      // HOUP-225: "Needed only" now cuts per-aisle (mirrors web page.tsx's
      // `visible`) rather than being baked into `grouped` — a just-checked-off
      // item stays visible through its grace window (pendingGroceryIds).
      const visibleItems = filterNeeded
        ? aisleItems.filter((i) => i.status === 'needed' || pendingGroceryIds.has(i.id))
        : aisleItems;
      // HOUP-175 review fix: web renders status-partitioned (needed → bought
      // → have) with sort_order only as the within-status tiebreaker —
      // page.tsx:985-987.
      const displayItems = [
        ...visibleItems.filter((i) => i.status === 'needed'),
        ...visibleItems.filter((i) => i.status === 'bought'),
        ...visibleItems.filter((i) => i.status === 'have'),
      ];
      const meta = getAisleMeta(aisleKey, customAisles);
      const collapsed = collapsedAisles.has(aisleKey);
      const subtotal = sumEstimate(aisleItems.filter((i) => i.status !== 'have'));
      // HOUP-225: bought/buyable ratio (web page.tsx) — computed over the
      // full (unfiltered-by-hideNonNeeded) aisle, same as the subtotal above.
      // The all-done green tint is gone (Hearth v2 H2: neutral headers).
      const aisleNeeded = aisleItems.filter((i) => i.status === 'needed').length;
      const aisleBought = aisleItems.filter((i) => i.status === 'bought').length;
      const aisleBuyable = aisleNeeded + aisleBought;
      const isCustom = (customAisles ?? []).some((a) => a.name === aisleKey);

      rows.push({
        kind: 'aisle-header',
        id: `aisle-header:${aisleKey}`,
        aisleKey,
        label: meta.label,
        icon: meta.icon,
        count: aisleItems.length,
        ratioText: aisleBuyable > 0 ? `${aisleBought}/${aisleBuyable}` : null,
        subtotalText: subtotal > 0 ? `~${formatMoney(subtotal)}` : null,
        isCustom,
        collapsed,
      });

      if (collapsed) continue;

      const lastIndex = displayItems.length - 1;
      displayItems.forEach((item, index) => {
        const pos: RowPos = displayItems.length === 1 ? 'only' : index === 0 ? 'first' : index === lastIndex ? 'last' : 'middle';
        rows.push({ kind: 'item', id: item.id, item, pos });
      });

      if (!selectMode && !searching) {
        rows.push({ kind: 'quick-add', id: `quick-add:${aisleKey}`, aisleKey, label: meta.label });
      }
    }
    return rows;
  }, [items.length, sortMode, searchedItems, orderedAisleKeys, grouped, customAisles, collapsedAisles, selectMode, sumEstimate, filterNeeded, pendingGroceryIds, searching]);

  // HOUP-225: persists to expo-secure-store on every toggle (was in-memory
  // only) — mirrors web page.tsx's saveCollapsedAisles.
  const toggleAisleCollapsed = React.useCallback((aisleKey: string) => {
    setCollapsedAisles((prev) => {
      const next = new Set(prev);
      if (next.has(aisleKey)) next.delete(aisleKey);
      else next.add(aisleKey);
      void SecureStore.setItemAsync(COLLAPSED_AISLES_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const renderItem = React.useCallback<ListRenderItem<GroceryRow>>(
    ({ item: row, index }) => {
      const prev = index > 0 ? flatData[index - 1] : undefined;
      const spacing = groceryRowSpacing(prev, row);
      if (row.kind === 'aisle-header') {
        return (
          <View className={cn('flex-row items-center gap-1.5 px-1', spacing)}>
            <Pressable onPress={() => toggleAisleCollapsed(row.aisleKey)} className="flex-1 flex-row items-center gap-1.5">
              {row.collapsed ? (
                <ChevronRight size={14} className="text-muted-foreground" />
              ) : (
                <ChevronDown size={14} className="text-muted-foreground" />
              )}
              <GroceryGlyph emoji={row.icon} size={13} />
              {/* HOUP-298: cap-inscription parity with web's aisle header —
                  resolves to Cinzel under Axis Mundi themes, body face
                  elsewhere. H2: group headers stay neutral; "all done"
                  reads from the ratio (5/5), not a green tint. */}
              <Text className="cap-inscription text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {row.label}
              </Text>
              <Text className="text-xs text-muted-foreground/70" style={{ fontVariant: ['tabular-nums'] }}>
                {row.count}
              </Text>
              <View className="flex-1" />
              {/* Bought/buyable ratio + subtotal aggregate (web page.tsx). */}
              {(row.ratioText || row.subtotalText) && (
                <Text className="text-xs font-medium text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {row.ratioText}
                  {row.ratioText && row.subtotalText ? ' · ' : ''}
                  {row.subtotalText}
                </Text>
              )}
            </Pressable>
            {row.isCustom && (
              <Pressable
                onPress={() => deleteCustomAisle(row.aisleKey)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Delete the ${row.label} aisle`}
                className="h-7 w-7 items-center justify-center rounded"
              >
                <Trash2 size={13} className="text-muted-foreground/70" />
              </Pressable>
            )}
          </View>
        );
      }
      if (row.kind === 'tier-label') {
        // HOUP-317: takes groupFrameClass's base frame (like an item row) so
        // it shares the card with its neighbours, styled per virtual-list.ts's
        // `SectionRow`'s `group-header` typography/tone.
        return (
          <View className={cn(groupFrameClass(row.pos), spacing, 'px-3 py-2')}>
            <Text className="cap-inscription text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Not needed
            </Text>
          </View>
        );
      }
      if (row.kind === 'item') {
        return (
          <View className={cn(groupFrameClass(row.pos), spacing)}>
            <GroceryItemCard
              item={row.item}
              customAisles={customAisles}
              resolvedShelfLifeDays={resolveItemDefaults(row.item.name, libMap).days}
              libraryPriceCents={priceFor(row.item.name)}
              onPatch={patchGroceryItem}
              onEdit={openEdit}
              onArchive={handleArchive}
              onRequestDelete={handleRequestDelete}
              onLearnPrice={handleLearnPrice}
              memberProfiles={memberProfiles}
              selectMode={selectMode}
              selected={selectedIds.has(row.item.id)}
              onToggleSelect={toggleSelect}
              showNeedAgain={searching}
              // HOUP-317 parity with web: the aisle dot only earns its place
              // in One list, where there are no aisle headers.
              showAisleDot={sortMode === 'flat'}
            />
          </View>
        );
      }
      // quick-add
      return (
        <View className={cn('flex-row items-center gap-2 px-1', spacing)}>
          {/* h-11 + explicit lineHeight: the default h-8 Input clipped
              descenders on native (Android in particular) — mirrors the M2
              44px touch floor too. */}
          <Input
            value={quickAddDrafts[row.aisleKey] ?? ''}
            onChangeText={(v) => setQuickAddDrafts((d) => ({ ...d, [row.aisleKey]: v }))}
            onSubmitEditing={() => quickAdd(quickAddDrafts[row.aisleKey] ?? '', row.aisleKey)}
            placeholder={`Add to ${row.label.toLowerCase()}…`}
            returnKeyType="done"
            className="h-11 flex-1 px-2.5 text-body text-foreground"
            style={{ lineHeight: 18 }}
          />
          <Pressable
            onPress={() => quickAdd(quickAddDrafts[row.aisleKey] ?? '', row.aisleKey)}
            className="h-11 w-11 items-center justify-center rounded-lg border border-input"
          >
            <Plus size={14} className="text-muted-foreground" />
          </Pressable>
          {/* "Details" (web page.tsx:1418-1420): opens the full add-item
              sheet, prefilled to this aisle, for anything beyond a bare name. */}
          <Pressable onPress={() => openAdd(row.aisleKey)} className="h-11 items-center justify-center px-1">
            <Text className="text-xs text-muted-foreground">Details</Text>
          </Pressable>
        </View>
      );
    },
    [
      flatData,
      customAisles,
      libMap,
      priceFor,
      patchRow,
      handleArchive,
      handleRequestDelete,
      handleLearnPrice,
      memberProfiles,
      selectMode,
      selectedIds,
      toggleSelect,
      searching,
      sortMode,
      quickAddDrafts,
      quickAdd,
      toggleAisleCollapsed,
      deleteCustomAisle,
      openAdd,
    ]
  );

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

  // Track / Not today answer on the tap: pendingTracking hides the ask (and
  // shows the pill for Track) while the session saves, and a second tap in
  // that window is ignored. The save carries today's running sum so the
  // session-cost sync has nothing left to write straight after.
  const setTracking = async (tracking: 'on' | 'skipped') => {
    if (pendingTracking) return;
    setPendingTracking(tracking);
    try {
      const supabase = getCurrentSupabaseClient();
      const s = await ensureSession(supabase, group.id, tracking, sessionSummedCents);
      if (s) {
        setSession(s);
        setCachedSession(group.id, todayStr(), s);
      } else {
        toast.error(tracking === 'on' ? "Couldn't start tracking, try again" : "Couldn't save that, try again");
      }
    } finally {
      setPendingTracking(null);
    }
  };
  const handleStartTracking = () => setTracking('on');
  const handleSkipTracking = () => setTracking('skipped');
  // Optimistic: the pill shows the new total on commit; the saved row (or the
  // old one, if the save fails) replaces it when the write returns.
  const handleOverrideTotal = async (cents: number | null) => {
    if (!session) return;
    const before = session;
    setSession({ ...session, override_total_cents: cents });
    const supabase = getCurrentSupabaseClient();
    const s = await updateSession(supabase, session.id, { override_total_cents: cents });
    setSession(s ?? before);
    if (!s) toast.error("Couldn't change the total, try again");
  };
  const handleStopTracking = async () => {
    if (!session) return;
    const before = session;
    setSession({ ...session, tracking: 'skipped' });
    const supabase = getCurrentSupabaseClient();
    const s = await updateSession(supabase, session.id, { tracking: 'skipped' });
    setSession(s ?? before);
    if (!s) toast.error("Couldn't stop tracking, try again");
  };
  // Done shopping (web page.tsx:560-598): freezes the session first (so its
  // Costs line survives), then flips every item bought today to Have it —
  // committed immediately, with a 5s undo toast that restores BOTH halves
  // (item statuses back to Got it, and the session reopened if this call
  // closed it).
  const handleDoneShopping = async (sessionArg?: GrocerySession) => {
    const activeSession = sessionArg ?? session;
    if (!activeSession) return;
    const supabase = getCurrentSupabaseClient();
    const today = todayStr();
    const todayBought = items.filter((i) => isBoughtToday(i, today));
    if (!todayBought.length) return;
    const snapshot = todayBought.map((i) => ({ id: i.id, last_purchased_at: i.last_purchased_at }));
    const didClose = activeSession.tracking === 'on' && !activeSession.closed_at;
    if (didClose) {
      const closed = await closeSession(supabase, activeSession.id);
      if (!closed) {
        toast.error("Couldn't finish shop, try again");
        return;
      }
      setSession(closed);
    }
    const now = new Date().toISOString();
    snapshot.forEach((s) => patchRow(s.id, { status: 'have', status_changed_at: now, last_purchased_at: null }));
    haptics.success();
    toast.message(`${snapshot.length} item${snapshot.length === 1 ? '' : 's'} marked Have it`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onPress: () => {
          snapshot.forEach((s) =>
            patchRow(s.id, { status: 'bought', status_changed_at: new Date().toISOString(), last_purchased_at: s.last_purchased_at })
          );
          if (didClose) {
            void updateSession(supabase, activeSession.id, { closed_at: null }).then((s) => {
              if (s) setSession(s);
            });
          }
        },
      },
    });
  };
  // Receipt entry point (HOUP-80 item 6, HOUP-226 full port): reuses the same
  // core sequence as capture-flow.tsx's "Grocery Bill" pipeline (uploadReceipt
  // -> updateSession -> syncSession) rather than re-implementing it, but lets
  // the user pick camera/library/PDF here instead of routing through
  // CaptureFlow's wizard — this button's job is "attach a receipt to today's
  // already-active session," not "start a session from a picked file."
  const pickReceiptSource = () =>
    new Promise<'camera' | 'library' | 'files' | null>((resolve) => {
      dialog.alert('Add receipt', undefined, [
        { text: 'Camera', onPress: () => resolve('camera') },
        { text: 'Photo Library', onPress: () => resolve('library') },
        { text: 'Choose PDF…', onPress: () => resolve('files') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    });

  // Upload a picked receipt onto the trip, then read it (OCR via
  // /api/parse-receipt -> receipt_total_cents + retailer; applyReceiptLearning
  // writes learned prices straight to grocery_items, and groceryItems$'s own
  // realtime subscription reflects them back). Returns the updated session,
  // or null with `receiptError` set. Pass the session explicitly: the finish
  // flow chains calls faster than `session` state updates.
  const attachAndReadReceipt = async (source: 'camera' | 'library' | 'files', base: GrocerySession): Promise<GrocerySession | null> => {
    if (!group) return null;
    const result =
      source === 'camera' ? await pickFromCamera() : source === 'library' ? await pickFromLibrary() : await pickFromFiles();
    if (result.permissionDenied || !result.files.length) return null;
    const picked: PickedFile = result.files[0];
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      const base64 = await FileSystem.readAsStringAsync(picked.uri, { encoding: FileSystem.EncodingType.Base64 });
      const body = decode(base64);
      const mimeType = picked.mimeType ?? 'image/jpeg';
      const input: DocumentUploadInput = {
        body,
        filename: picked.filename,
        mimeType,
        sizeBytes: body.byteLength,
      };
      const supabase = getCurrentSupabaseClient();
      const up = await uploadReceipt(supabase, group.id, base.session_date, input);
      if (!up) {
        setReceiptError('Receipt upload failed. Tap to try again.');
        return null;
      }
      let updated = (await updateSession(supabase, base.id, { receipt_path: up.path, receipt_name: up.name })) ?? base;
      setSession(updated);
      const parsed = await parseReceiptFile(`data:${mimeType};base64,${base64}`, mimeType);
      if (!parsed) {
        setReceiptError("Couldn't read the receipt. Tap to try again.");
        setCachedSession(group.id, todayStr(), updated);
        return null;
      }
      const patch: Partial<GrocerySession> = {};
      if (parsed.total != null) patch.receipt_total_cents = Math.round(parsed.total * 100);
      if (parsed.retailer) patch.retailer = parsed.retailer;
      if (Object.keys(patch).length) updated = (await updateSession(supabase, updated.id, patch)) ?? updated;
      setSession(updated);
      setCachedSession(group.id, todayStr(), updated);
      await applyReceiptLearning(supabase, group.id, parsed, items);
      return updated;
    } catch {
      setReceiptError('Receipt upload failed. Tap to try again.');
      return null;
    } finally {
      setReceiptBusy(false);
    }
  };

  // The pill's Receipt: pick a source, attach and read it, keep shopping.
  const handleAddReceipt = async () => {
    if (!session || receiptBusy) return;
    const source = await pickReceiptSource();
    if (!source) return;
    await attachAndReadReceipt(source, session);
  };

  // The finish sheet: optionally read a receipt, bring the Costs line up to
  // the trip's effective total (receipt or override), then Done shopping.
  const handleFinish = async (source: FinishReceiptSource) => {
    if (!session || !group || receiptBusy) return;
    let current: GrocerySession | null = session;
    if (source) {
      current = await attachAndReadReceipt(source, session);
      if (!current) return;
    }
    try {
      const supabase = getCurrentSupabaseClient();
      // Modules: the trip's cost line needs costs and groceries (module-features.ts).
      current = await syncSession(supabase, current, group.id, sessionSummedCents, isFeatureEnabled('costs.from-groceries', getEnabledModules()));
    } catch (err) {
      console.error('grocery session sync failed:', err);
    }
    setFinishOpen(false);
    await handleDoneShopping(current);
  };

  // Lede caption fragments (the estimate lives in the This trip summary).
  const ledeCaption = (() => {
    if (items.length === 0) return 'Your list is empty';
    const fragments = [
      neededCount === 0 ? 'All bought' : null,
      haveCount > 0 ? `${haveCount} have` : null,
      boughtCount > 0 ? `${boughtCount} got today` : null,
    ].filter(Boolean);
    return fragments.length ? fragments.join(' · ') : undefined;
  })();
  // While a shop is tracked the collapsed bar shows the running total instead.
  const collapsedCaption = session?.tracking === 'on' ? `${formatMoney(effectiveSessionTotal(session))} in cart` : ledeCaption;

  const closeMenus = () => {
    setMoreAnchor(null);
    setViewAnchor(null);
  };
  const moreItems: ActionMenuItem[] = [
    { key: 'select', label: 'Select', Icon: SquareCheck, onPress: () => (closeMenus(), setSelectMode(true)) },
    // HOUP-317: Reorder is aisle-only — One list has no drag/sort_order.
    ...(sortMode === 'aisle'
      ? [{ key: 'reorder', label: 'Reorder', Icon: ArrowUpDown, onPress: () => (closeMenus(), setReorderMode(true)) }]
      : []),
    { key: 'library', label: 'Item library', Icon: BookOpen, onPress: () => (closeMenus(), router.push('/groceries/shelf-life' as Href)) },
    ...(session?.tracking === 'skipped'
      ? [{ key: 'track', label: 'Track shop', Icon: Receipt, onPress: () => (closeMenus(), void handleStartTracking()) }]
      : []),
    ...(boughtStatusCount > 0
      ? [{ key: 'reset', label: `Reset bought (${boughtStatusCount})`, Icon: RotateCcw, onPress: () => (closeMenus(), resetBought()) }]
      : []),
  ];
  const viewItems: ActionMenuItem[] = [
    { key: 'aisle', label: 'By aisle', checked: sortMode === 'aisle', onPress: () => (closeMenus(), handleSortModeChange('aisle')) },
    { key: 'flat', label: 'One list', checked: sortMode === 'flat', onPress: () => (closeMenus(), handleSortModeChange('flat')) },
    { key: 'needed', label: 'Only needed', checked: hideNonNeeded, onPress: () => (closeMenus(), setHideNonNeeded((v) => !v)) },
  ];

  const listHeaderElement = (
    <GroceriesListHeader
      itemsCount={items.length}
      neededCount={neededCount}
      caption={ledeCaption}
      staplesAvailable={getRegionProvider(group.region).groceryStaples.length > 0}
      onSeedStaples={seedStaples}
      modeActive={selectMode || reorderMode}
      onExitMode={() => (selectMode ? exitSelectMode() : setReorderMode(false))}
      onOpenMore={setMoreAnchor}
      onOpenView={setViewAnchor}
      viewFiltered={hideNonNeeded}
      onOpenCards={() => setCardsOpen(true)}
      onAddItem={() => openAdd()}
      onHeadLayout={(bottom) => {
        headBottomRef.current = bottom;
      }}
      search={search}
      onSearchChange={setSearch}
      onSearchSubmit={submitSearchAdd}
      onSuggestAdd={groceryUndo.needAgain}
      suggestions={suggestions}
      onSuggestSnooze={groceryUndo.snooze}
      suggestDismissAction={suggestDismiss.dismissAction}
      onSuggestDismiss={suggestDismiss.dismiss}
      onSuggestAddAll={() => groceryUndo.needAgain(suggestions)}
    />
  );

  const tripSummaryElement =
    items.length > 0 ? (
      <GroceriesTripSummary
        estTotal={estTotal}
        buyableCount={buyableItems.length}
        unpricedCount={pulseUnpricedCount}
        showTrack={session?.tracking === 'skipped'}
        onTrack={() => void handleStartTracking()}
        boughtStatusCount={boughtStatusCount}
        onResetBought={resetBought}
      />
    ) : null;

  const addAisleFooterElement = (
    <GroceriesAddAisleFooter
      addAisleOpen={addAisleOpen}
      newAisleName={newAisleName}
      onNewAisleNameChange={setNewAisleName}
      newAisleColor={newAisleColor}
      onNewAisleColorChange={setNewAisleColor}
      onSubmit={addCustomAisle}
      onOpen={() => setAddAisleOpen(true)}
      onCancel={() => setAddAisleOpen(false)}
    />
  );

  // Search add panel: rendered as the list footer while a query is active
  // (in place of the add-aisle control), so on-list matches stay directly
  // under the search bar and the add options follow them. With no matches
  // it's the only thing under the bar.
  const searchAddElement = searching ? (
    <GroceriesSearchAdd
      noMatches={searchedItems.length === 0}
      addName={searchAdd.addName}
      addAisle={searchAdd.addAisle}
      suggestions={searchAdd.librarySuggestions}
      customAisles={customAisles}
      quantity={searchAdd}
      onAddSuggestion={(s) => {
        quickAdd(s.item_name, s.aisle ?? 'other', searchAdd);
        setSearch('');
      }}
      onAddPlain={(name, aisle) => {
        quickAdd(name, aisle, searchAdd);
        setSearch('');
      }}
    />
  ) : null;

  // The track-today ask floats over the list (never pushes it down) while
  // nothing else owns the bottom edge: Select's bulk bar, Reorder, search.
  const showTrackPrompt =
    sessionKnown && session === null && pendingTracking === null && boughtCount > 0 && !reorderMode && !selectMode && !searching;
  // Clears the capture button's raised lip above the in-flow tab bar.
  const trackPromptBottom = 32;
  // Once tracking, the shop pill takes the prompt's spot (same hiding rules).
  const trackingOn = (session?.tracking === 'on' && !session.closed_at) || pendingTracking === 'on';
  const showShopPill = trackingOn && !reorderMode && !selectMode && !searching;
  // While Track's save is in flight the pill reads from a stand-in session
  // carrying today's running sum (display only, never written).
  const pillSession: GrocerySession | null =
    session?.tracking === 'on' && !session.closed_at
      ? session
      : pendingTracking === 'on'
        ? {
            id: '',
            group_id: group.id,
            session_date: todayStr(),
            summed_total_cents: sessionSummedCents,
            override_total_cents: null,
            receipt_total_cents: null,
            retailer: null,
            receipt_path: null,
            receipt_name: null,
            tracking: 'on',
            cost_item_id: null,
            closed_at: null,
            created_by: null,
            created_at: '',
            updated_at: '',
          }
        : null;
  const listPaddingBottom = insets.bottom + 96 + (showTrackPrompt || showShopPill ? 72 : 0);

  return (
    <ScreenBackground>
      {reorderMode ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: listPaddingBottom }}
          keyboardShouldPersistTaps="handled"
        >
          {listHeaderElement}

          {items.length === 0 ? null : (
            <View className="gap-4">
              {orderedAisleKeys.map((aisleKey) => {
                const aisleItems = grouped.get(aisleKey) ?? [];
                const meta = getAisleMeta(aisleKey, customAisles);
                const collapsed = collapsedAisles.has(aisleKey);
                const subtotal = sumEstimate(aisleItems.filter((i) => i.status !== 'have'));
                const aisleToBuyCount = aisleItems.filter((i) => i.status === 'needed').length;
                return (
                  <View key={aisleKey} className="gap-2">
                    <Pressable onPress={() => toggleAisleCollapsed(aisleKey)} className="flex-row items-center gap-1.5 px-1">
                      {collapsed ? (
                        <ChevronRight size={14} className="text-muted-foreground" />
                      ) : (
                        <ChevronDown size={14} className="text-muted-foreground" />
                      )}
                      <GroceryGlyph emoji={meta.icon} size={13} />
                      <Text className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                        {meta.label}
                      </Text>
                      <Text className="text-xs text-muted-foreground/70" style={{ fontVariant: ['tabular-nums'] }}>
                        {aisleItems.length}
                      </Text>
                      <View className="flex-1" />
                      {aisleToBuyCount > 0 && (
                        <Text className="text-xs font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                          {formatMoney(subtotal)} · {aisleToBuyCount} to buy
                        </Text>
                      )}
                    </Pressable>
                    {!collapsed && (
                      <ReorderableList
                        data={aisleItems}
                        keyExtractor={(item) => item.id}
                        onReorder={(nextIds) => reorderAisleItems(aisleKey, nextIds)}
                        renderItem={(item, dragging) => (
                          <GroceryItemCard
                            item={item}
                            customAisles={customAisles}
                            resolvedShelfLifeDays={resolveItemDefaults(item.name, libMap).days}
                            libraryPriceCents={priceFor(item.name)}
                            onPatch={patchRow}
                            onEdit={openEdit}
                            reorderMode
                            dragging={dragging}
                          />
                        )}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {searchAddElement ?? addAisleFooterElement}
        </ScrollView>
      ) : (
        <FlashList
          data={flatData}
          keyExtractor={(row) => row.id}
          getItemType={(row) => row.kind}
          renderItem={renderItem}
          ListHeaderComponent={listHeaderElement}
          // HOUP-317: aisle-management chrome hidden in One list.
          ListFooterComponent={
            searchAddElement ?? (
              <>
                {tripSummaryElement}
                {sortMode === 'flat' ? null : addAisleFooterElement}
              </>
            )
          }
          keyboardShouldPersistTaps="handled"
          renderScrollComponent={KeyboardAwareScrollView}
          ref={listRef}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: listPaddingBottom }}
        />
      )}

      {collapsed && !reorderMode && (
        <GroceriesCollapsedBar
          topInset={insets.top}
          neededCount={neededCount}
          caption={collapsedCaption}
          viewFiltered={hideNonNeeded}
          onSearch={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
          onOpenCards={() => setCardsOpen(true)}
          onOpenView={setViewAnchor}
          onAddItem={() => openAdd()}
        />
      )}

      <ActionMenu anchor={moreAnchor} onClose={() => setMoreAnchor(null)} items={moreItems} />
      <ActionMenu anchor={viewAnchor} onClose={() => setViewAnchor(null)} items={viewItems} />

      {showShopPill && pillSession && (
        <ShopTrackingPill
          session={pillSession}
          pending={pillSession !== session}
          boughtCount={boughtCount}
          bottom={trackPromptBottom}
          onOverrideTotal={handleOverrideTotal}
          onReceipt={() => void handleAddReceipt()}
          receiptBusy={receiptBusy}
          receiptError={receiptError}
          onDone={() => setFinishOpen(true)}
        />
      )}

      <FinishShopSheet
        open={finishOpen}
        onOpenChange={setFinishOpen}
        session={session}
        boughtCount={boughtCount}
        unpricedCount={unpricedCount}
        onOverrideTotal={handleOverrideTotal}
        onFinish={(source) => void handleFinish(source)}
        onStopTracking={() => {
          setFinishOpen(false);
          void handleStopTracking();
        }}
        busy={receiptBusy}
        error={receiptError}
      />

      {showTrackPrompt && (
        <TrackShopPrompt
          boughtCount={boughtCount}
          summedCents={sessionSummedCents}
          bottom={trackPromptBottom}
          onStartTracking={handleStartTracking}
          onSkipTracking={handleSkipTracking}
        />
      )}

      {!reorderMode && selectMode && selectedIds.size > 0 && (
        <View
          className="absolute inset-x-4 flex-row items-center justify-between gap-2 rounded-xl border border-border bg-popover px-3.5 py-2.5 shadow-lg"
          style={{ bottom: insets.bottom + 16 }}
        >
          <Text className="text-caption text-muted-foreground">{selectedIds.size} selected</Text>
          <View className="flex-row items-center gap-2">
            <Button size="sm" variant="outline" onPress={() => setBulkSheetOpen(true)}>
              Set aisle
            </Button>
            <Button size="sm" variant="outline" onPress={() => setBulkAssignOpen(true)}>
              Assign
            </Button>
            <Button size="sm" variant="destructive" onPress={bulkDelete}>
              Delete
            </Button>
            {/* Clear selection (web page.tsx:1322-1327): clears the set without
                exiting Select mode, so a new selection can start immediately. */}
            <Pressable
              onPress={() => setSelectedIds(new Set())}
              accessibilityLabel="Clear selection"
              className="h-7 w-7 items-center justify-center rounded-lg"
            >
              <X size={16} className="text-muted-foreground" />
            </Pressable>
          </View>
        </View>
      )}

      <GroceryItemFormSheet
        key={editingItem?.id ?? 'new'}
        open={formOpen}
        onOpenChange={(open) => {
          // HOUP-191: `key={editingItem?.id ?? 'new'}` remounts the sheet
          // the instant `editingItem` clears — doing that in the same tick
          // as `formOpen=false` used to skip the 250ms exit animation
          // entirely (the remounted instance started already-closed).
          setFormOpen(open);
          if (!open) setTimeout(() => setEditingItem(undefined), MOTION_DURATIONS_MS.exit);
        }}
        item={editingItem}
        groupId={group.id}
        currentUserId={currentUserId}
        defaultAisle={defaultAisle}
        customAisles={customAisles}
        aisleUnits={userSettings?.grocery_aisle_units ?? undefined}
        libMap={libMap}
        memberProfiles={memberProfiles}
        onSave={(saved) => writeRow(saved)}
        onDelete={handleArchive}
      />

      <BulkActionsSheet open={bulkSheetOpen} onOpenChange={setBulkSheetOpen} customAisles={customAisles} onSetAisle={bulkSetAisle} />
      <RewardsCardsSheet
        open={cardsOpen}
        onOpenChange={setCardsOpen}
        cards={cards}
        groupId={group.id}
        initialCardId={cards.length === 1 ? cards[0].id : null}
        onSave={writeCard}
        onDelete={(card) => softDeleteCard(card.id)}
      />
      <BulkAssignSheet open={bulkAssignOpen} onOpenChange={setBulkAssignOpen} memberProfiles={memberProfiles} onAssign={bulkAssign} />
    </ScreenBackground>
  );
}
