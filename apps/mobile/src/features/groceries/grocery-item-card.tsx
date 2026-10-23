// HOUP-80: native grocery row. Faithful port of the disposition + portal-chip
// logic from apps/web/src/app/groceries/grocery-item-card.tsx (lines ~340-450):
// swipe right toggles needed<->bought, swipe left toggles needed<->have —
// exactly mirrors web's setDisposition, not the compressed "right=bought/have,
// left=snooze" gloss in the ticket body (snooze itself lives on the
// suggest-re-add row, not this swipe).
//
// HOUP-224: long-press now opens the row's overflow menu (`GroceryItemQuickMenu`)
// instead of jumping straight to the edit sheet — mirrors task-row.tsx's
// TaskQuickMenu wiring. Qty is a row-level chip (tap = exact-value
// entry, drag = adjust) via `@homeup/ui`'s `DragNumberField` — the same
// primitive the edit sheet already uses for the identical tap+drag contract,
// reused here rather than hand-rolling a second native gesture implementation
// (web's own `useDragNumber` pointer-capture hook has no native equivalent to
// port 1:1 anyway). Archive/Delete are now distinct actions (see
// apps/mobile/src/app/(tabs)/groceries/index.tsx's handleArchive/handleRequestDelete)
// instead of the old single always-learns-to-library `onEdit`-triggered delete.
//
// The price no longer drags on the row (it changed by accident, Guy
// 2026-10-20): tapping it opens `PopoverNumberField`'s small editor beside
// it, which types or drags the value and commits when tapped away from.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Check, ChefHat, GripVertical, PackageCheck, RefreshCw } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  DragNumberField,
  PopoverNumberField,
  EditableText,
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  PortalChipRow,
  SwipeActions,
  cn,
  haptics,
  useHoldFill,
  type PortalChipDef,
  GroceryGlyph,
} from '@homeup/ui';
import {
  getAisleColor,
  getGroceryEmoji,
  qtyLabel,
  freshnessWindow,
  applyGroceryDisposition,
  timeAgo,
  daysUntilISO,
  useModules,
  currencySymbol,
  unitQtyMax,
  unitQtyStep,
  type GroceryCustomAisle,
  type GroceryItem,
} from '@homeup/core';
import { GroceryItemQuickMenu } from './grocery-item-quick-menu';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

interface GroceryItemCardProps {
  item: GroceryItem;
  customAisles?: GroceryCustomAisle[];
  resolvedShelfLifeDays?: number | null;
  libraryPriceCents?: number | null;
  onPatch: (id: string, patch: Partial<GroceryItem>) => void;
  onEdit: (item: GroceryItem) => void;
  /** HOUP-224: distinct from onRequestDelete — learns the item to the shared library, no confirm. Omitted for select/reorder-mode renders (the quick menu that calls it is unreachable there). */
  onArchive?: (item: GroceryItem) => void;
  /** HOUP-224: destructive, confirm-gated (inside the quick menu), never learns to the library. */
  onRequestDelete?: (item: GroceryItem) => void;
  /** HOUP-224: fired (debounced) when the row-level price chip settles on a new value — the "teach the shared library" side effect, kept out of this presentational component. */
  onLearnPrice?: (name: string, cents: number) => void;
  /** HOUP-224: powers the quick menu's "Assign to" section. */
  memberProfiles?: MemberProfiles;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** HOUP-175: renders the leading slot as a drag handle and suppresses tap-to-edit/swipe. Mutually exclusive with selectMode (mirrors HOUP-129's SetupItemCard). */
  reorderMode?: boolean;
  /** HOUP-175: true while this row is the one currently being dragged, from `ReorderableList`'s renderItem. */
  dragging?: boolean;
  /** Search results: a have/bought row gets a one-tap "Need again" pill. */
  showNeedAgain?: boolean;
  /** HOUP-317: "One list" shows the aisle as a colour dot (there are no aisle
   *  headers there). Off by default: the aisle view's header already says it. */
  showAisleDot?: boolean;
}

// HOUP-198: matches task-row.tsx's hold-to-edit timing (HOUP-144).
const LONG_PRESS_MS = 500;

function isDecimalUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? '').toLowerCase().trim();
  return u === 'kg' || u === 'l' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters';
}

// Compact chip styling shared by the row's qty/price DragNumberField
// instances — strips the form field's border/padding down to an inline
// meta/trailing fragment.
const CHIP_CLASS = 'h-auto min-h-0 gap-0.5 rounded border-0 bg-transparent px-0 py-0';

export function GroceryItemCard({
  item,
  customAisles,
  resolvedShelfLifeDays,
  libraryPriceCents,
  onPatch,
  onEdit,
  onArchive,
  onRequestDelete,
  onLearnPrice,
  memberProfiles,
  selectMode,
  selected,
  onToggleSelect,
  reorderMode,
  dragging,
  showNeedAgain,
  showAisleDot = false,
}: GroceryItemCardProps) {
  const router = useRouter();
  const bought = item.status === 'bought';
  const have = item.status === 'have';
  // HOUP-198: hold-to-edit arming fill — wired through SwipeActions' onLongPress
  // (see swipe-actions.tsx header comment for why a bare ListItem.onLongPress
  // never reliably fires here, nested inside SwipeActions' Pan GestureDetector).
  const holdFill = useHoldFill(LONG_PRESS_MS);
  const [quickMenuOpen, setQuickMenuOpen] = React.useState(false);
  // PC5/PC6: the recipe portal falls back to a neutral note sheet when the
  // item has no real recipe entity to navigate to (recipe_note without a
  // recipe_source_id) — mirrors web grocery-item-card.tsx:951-966. Today's
  // tap was dead (onOpen was a no-op in this case).
  const [noteSheetOpen, setNoteSheetOpen] = React.useState(false);
  const modules = useModules();
  // Modules: the recipe chip (and its note sheet) needs recipes and groceries (module-features.ts).
  const recipeLinked = modules.feature('recipes.groceries');

  // Effective price = the item's own price, else the library's typical price
  // for its name (matches web grocery-item-card.tsx's effectivePriceCents).
  const hasExplicitPrice = item.price_cents != null;
  const effectivePriceCents = item.price_cents ?? libraryPriceCents ?? null;

  const setDisposition = React.useCallback(
    (target: GroceryItem['status']) => {
      onPatch(item.id, applyGroceryDisposition(item, target, { priceCents: effectivePriceCents }));
    },
    [item, effectivePriceCents, onPatch]
  );

  // Price commit — the store write is immediate/optimistic (matches every
  // other onPatch call on this row). The popover commits once, on close; the
  // "teach the shared library" write stays debounced so a quick re-edit
  // doesn't fire two upserts.
  const priceLearnTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (priceLearnTimer.current) clearTimeout(priceLearnTimer.current);
  }, []);
  const handlePriceChange = React.useCallback(
    (dollars: number | null) => {
      const cents = dollars != null ? Math.round(dollars * 100) : null;
      onPatch(item.id, { price_cents: cents });
      if (priceLearnTimer.current) clearTimeout(priceLearnTimer.current);
      if (cents != null && onLearnPrice) {
        priceLearnTimer.current = setTimeout(() => onLearnPrice(item.name, cents), 600);
      }
    },
    [item.id, item.name, onPatch, onLearnPrice]
  );

  const dot = getAisleColor(item.aisle, customAisles).dot;
  const emoji = getGroceryEmoji(item.name, item.aisle);
  const qty = qtyLabel(item);
  const qtyValue = item.quantity ?? 1;
  const showQty = qtyValue !== 1 && qtyValue !== 0;
  const isAutoAdded = !!item.template_key || !!item.recurrence_days;

  const effectiveShelfLifeDays = item.shelf_life_days ?? resolvedShelfLifeDays ?? null;
  const fw = have ? freshnessWindow(item.status_changed_at, effectiveShelfLifeDays) : null;

  const statusRel = timeAgo(item.status_changed_at);
  const statusShort = statusRel ? statusRel.replace(/ ago$/, '') : null;

  const expiryDays = item.expiry_date ? daysUntilISO(item.expiry_date) : null;

  const hasRecipeRoute = !!item.recipe_source_id;
  const recipeChips: PortalChipDef[] = recipeLinked && item.recipe_note
    ? [
        {
          key: 'recipe',
          icon: <ChefHat size={13} className="text-muted-foreground" />,
          label: item.recipe_note,
          tone: hasRecipeRoute ? 'accent' : 'neutral',
          onOpen: () => {
            if (hasRecipeRoute) router.push(`/recipes/${item.recipe_source_id}` as Href);
            else setNoteSheetOpen(true);
          },
        },
      ]
    : [];

  const metaParts: React.ReactNode[] = [];
  if (showQty) {
    metaParts.push(
      <DragNumberField
        key="qty"
        value={qtyValue}
        onChange={(v) => onPatch(item.id, { quantity: v ?? 0 })}
        step={unitQtyStep(item.unit)}
        min={0}
        max={unitQtyMax(item.unit)}
        precision={isDecimalUnit(item.unit) ? 2 : 0}
        trimTrailingZeros
        suffix={item.unit || undefined}
        hideIcon
        accessibilityLabel="Quantity: tap to edit, drag up or down to adjust"
        className={CHIP_CLASS}
      />
    );
  }
  if (bought) {
    metaParts.push(
      <Text key="disposition" className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {`bought${statusShort ? ` ${statusShort}` : ''}`}
      </Text>
    );
  } else if (have) {
    metaParts.push(
      <Text key="disposition" className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {`have${statusShort ? ` ${statusShort}` : ''}`}
      </Text>
    );
  }
  if (expiryDays != null) {
    metaParts.push(
      <Text
        key="expiry"
        className={cn(
          'text-caption',
          expiryDays < 0 ? 'text-destructive' : expiryDays <= 3 ? 'text-warning' : 'text-muted-foreground'
        )}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {expiryDays < 0 ? `expired ${Math.abs(expiryDays)}d ago` : expiryDays === 0 ? 'expires today' : `expires ${expiryDays}d`}
      </Text>
    );
  }
  if (item.notes) {
    metaParts.push(
      <Text key="notes" numberOfLines={1} className="max-w-[9rem] text-caption text-muted-foreground">
        {item.notes}
      </Text>
    );
  }
  if (isAutoAdded) {
    metaParts.push(<RefreshCw key="auto" size={11} className="text-muted-foreground/70" />);
  }

  const row = (
    <ListItem
      // A plain tap on the row does nothing (Guy, 2026-10-20: it opened the
      // edit sheet by accident); hold opens the quick menu, whose Edit opens
      // the sheet. The name and price keep their own tap targets.
      onPress={selectMode ? () => onToggleSelect?.(item.id) : undefined}
      // Normal mode's long-press now goes through SwipeActions' onLongPress
      // below; select/reorder mode bypasses SwipeActions entirely (no Pan to
      // conflict with), so selectMode keeps a direct ListItem.onLongPress.
      onLongPress={reorderMode ? undefined : selectMode ? () => onEdit(item) : undefined}
      holdProgress={!selectMode && !reorderMode ? holdFill.progress : undefined}
      // Hearth v2: the colored rails and row tints are retired (§3, H2/H4).
      // Got it takes the §6 done treatment (55% + strikethrough + check
      // badge). Have it sits below the aisle's "In the cupboard" divider on
      // a recessed inset fill (H4), with a greyed glyph and muted title.
      className={cn(dragging && 'bg-accent/30', bought && 'opacity-[0.55]', have && !dragging && 'bg-muted/50')}
    >
      <ListItemLeading>
        {reorderMode ? (
          <GripVertical size={16} className="text-muted-foreground" />
        ) : selectMode ? (
          <View
            className={cn(
              'h-5 w-5 items-center justify-center rounded-full border-2',
              selected ? 'border-primary bg-primary' : 'border-border'
            )}
          >
            {selected && <Check size={12} className="text-primary-foreground" />}
          </View>
        ) : (
          <>
            {have ? (
              // filter is Android-only in RN; iOS keeps the colour and the opacity.
              <View style={{ opacity: 0.55, filter: [{ grayscale: 0.85 }] }}>
                <GroceryGlyph emoji={emoji} size={20} />
              </View>
            ) : (
              <GroceryGlyph emoji={emoji} size={20} />
            )}
            {/* Done treatment (Hearth §6): a check badge on the leading chip
                — the emoji itself stays put (content exception, matches web's
                grocery-item-card.tsx:663-679). */}
            {bought && (
              <View className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 items-center justify-center rounded-full bg-success">
                <Check size={8} className="text-success-foreground" />
              </View>
            )}
            {/* Essential — a small dot on the leading chip rather than a
                whole-row tint (H2: status hues in small doses only). */}
            {item.is_essential && !bought && (
              <View className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning" />
            )}
          </>
        )}
      </ListItemLeading>

      <ListItemContent>
        <ListItemTitle
          className={cn(bought ? 'text-muted-foreground line-through' : have ? 'text-muted-foreground' : undefined)}
        >
          {reorderMode || selectMode ? (
            item.name
          ) : (
            // HOUP-187: tap-to-rename inline via EditableText — mirrors
            // web's hand-rolled name input/span (grocery-item-card.tsx), just
            // via the shared primitive. EditableText's nested Pressable
            // claims the touch when tapped directly on the name.
            <EditableText
              value={item.name}
              onCommit={(v) => {
                const next = v.trim();
                if (next && next !== item.name) onPatch(item.id, { name: next });
              }}
              triggerClassName="min-w-0"
            >
              <Text numberOfLines={1} className={cn(bought ? 'text-muted-foreground line-through' : have ? 'font-normal text-muted-foreground' : 'text-foreground')}>
                {item.name}
              </Text>
            </EditableText>
          )}
        </ListItemTitle>
        {metaParts.length > 0 && <ListItemMeta>{metaParts}</ListItemMeta>}
        {fw && (
          <View className="mt-1 flex-row items-center gap-2">
            {/* H3 deviation, approved in HOUP-285 grooming: this freshness
                meter stretches full-width (not the usual ~52px local meter).
                Scoped to this meter only — H3 still applies elsewhere. */}
            <View className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted/40">
              <View
                className={cn(
                  'h-full rounded-full',
                  fw.overdue ? 'bg-destructive' : fw.fraction >= 2 / 3 ? 'bg-warning' : 'bg-success'
                )}
                style={{ width: `${Math.round((1 - fw.fraction) * 100)}%` }}
              />
            </View>
            <Text
              className={cn(
                'shrink-0 text-caption',
                fw.overdue ? 'text-destructive' : fw.fraction >= 2 / 3 ? 'text-warning' : 'text-muted-foreground'
              )}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {fw.overdue ? `expired ~${Math.abs(fw.remainingDays)}d ago` : `~${fw.remainingDays}d left`}
            </Text>
          </View>
        )}
        {recipeChips.length > 0 && (
          <View pointerEvents={reorderMode ? 'none' : 'auto'} className={cn(reorderMode && 'opacity-50')}>
            <PortalChipRow chips={recipeChips} className="mt-1.5" overflowTitle="Recipe" />
          </View>
        )}
      </ListItemContent>

      <ListItemTrailing>
        {showNeedAgain && item.status !== 'needed' && !selectMode && !reorderMode && (
          <Pressable
            onPress={() => setDisposition('needed')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Need ${item.name} again`}
            className="h-8 flex-row items-center rounded-full border border-primary/30 bg-primary/10 px-2.5"
          >
            <Text className="text-xs font-medium text-primary">Need again</Text>
          </Pressable>
        )}
        {showAisleDot && <View className={cn('h-2 w-2 rounded-full', dot)} />}
        {effectivePriceCents != null && (
          <PopoverNumberField
            value={effectivePriceCents / 100}
            onChange={handlePriceChange}
            step={0.5}
            min={0}
            precision={2}
            prefix={hasExplicitPrice ? currencySymbol() : `~${currencySymbol()}`}
            inputPrefix={currencySymbol()}
            label={hasExplicitPrice ? `Price of ${item.name}` : `Price of ${item.name} (estimated)`}
            accessibilityLabel="Price: tap to change"
            // H2: a price is data, not state; muted like web's row.
            textClassName="text-muted-foreground"
            className={cn(
              'px-0.5',
              // Estimated (library-fallback) price reads visually lighter
              // than a real explicit price, so the two are distinguishable
              // at a glance.
              (!hasExplicitPrice || have) && 'opacity-60'
            )}
          />
        )}
      </ListItemTrailing>
    </ListItem>
  );

  // PC5/PC6 fallback: a recipe note with no real recipe entity to link to
  // opens its text in a neutral bottom sheet instead of inventing a route.
  const noteSheet = recipeLinked && !hasRecipeRoute && item.recipe_note ? (
    <BottomSheet open={noteSheetOpen} onOpenChange={setNoteSheetOpen}>
      <View className="gap-2 px-4 pb-2">
        <View className="flex-row items-center gap-2">
          <ChefHat size={16} className="text-muted-foreground" />
          <Text className="text-sm font-medium text-foreground">Recipe note</Text>
        </View>
        <Text className="text-sm text-muted-foreground">{item.recipe_note}</Text>
      </View>
    </BottomSheet>
  ) : null;

  if (selectMode || reorderMode) {
    return (
      <>
        {row}
        {noteSheet}
      </>
    );
  }

  return (
    <>
      <SwipeActions
        onSwipeRight={() => setDisposition(bought ? 'needed' : 'bought')}
        onSwipeLeft={() => setDisposition(have ? 'needed' : 'have')}
        right={{
          bg: 'bg-success/15',
          activeBg: 'bg-success',
          icon: <Check size={18} className="text-success" />,
          label: bought ? 'Needed' : 'Got it',
        }}
        left={{
          bg: 'bg-primary/15',
          activeBg: 'bg-primary',
          icon: <PackageCheck size={18} className="text-primary" />,
          label: have ? 'Needed' : 'Have it',
        }}
        longPressMs={LONG_PRESS_MS}
        onLongPress={() => { haptics.commit(); setQuickMenuOpen(true); }}
        onHoldStart={holdFill.start}
        onHoldEnd={holdFill.stop}
      >
        {row}
      </SwipeActions>
      {noteSheet}
      <GroceryItemQuickMenu
        open={quickMenuOpen}
        onOpenChange={setQuickMenuOpen}
        item={item}
        emoji={emoji}
        qty={qty}
        showQty={showQty}
        effectivePriceCents={effectivePriceCents}
        hasExplicitPrice={hasExplicitPrice}
        customAisles={customAisles}
        memberProfiles={memberProfiles}
        onSetDisposition={setDisposition}
        onToggleEssential={() => onPatch(item.id, { is_essential: !item.is_essential })}
        onEdit={() => onEdit(item)}
        onClearRecipeNote={
          recipeLinked && item.recipe_note ? () => onPatch(item.id, { recipe_note: null, recipe_source_id: null }) : undefined
        }
        onArchive={onArchive ? () => onArchive(item) : undefined}
        onRequestDelete={onRequestDelete ? () => onRequestDelete(item) : undefined}
        onAssign={(userId) => onPatch(item.id, { assigned_to: userId })}
        onSetAisle={(aisle) => onPatch(item.id, { aisle })}
      />
    </>
  );
}
