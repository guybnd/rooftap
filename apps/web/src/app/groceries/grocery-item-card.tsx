'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { GroceryItem, GroceryCustomAisle, GroupMember } from '@homeup/core';
import { getAisleMeta, getAisleColor, AISLE_ORDER, qtyLabel, freshnessWindow, daysUntilISO, currencySymbol } from '@homeup/core';
import { clearRecipeNoteOnLeaveNeeded, useModules } from '@homeup/core';
import { runNavTransition } from '@/lib/view-transitions';
import { getGroceryEmoji } from '@homeup/core';
import { GroceryGlyph } from '@/components/grocery-glyph';
import { formatMoney } from '@homeup/core';
import { SwipeActions } from '@/components/ui/swipe-actions';
import {
  Check,
  Pencil,
  Trash2,
  MoreHorizontal,
  GripVertical,
  CalendarClock,
  RefreshCw,
  Plus,
  Minus,
  DollarSign,
  PackageCheck,
  RotateCcw,
  Archive,
  ChefHat,
  UserPlus,
  Star,
  Circle,
} from 'lucide-react';
import { AssigneePicker } from '../setup/assignee-picker';
import { memberLabel } from '../setup/member-label';
import { PopMenu, MenuItem, MenuLabel, MenuDivider } from '../setup/pop-menu';
import { useRowContextMenu, withRowMenu } from '@/components/ui/row-context-menu';
import {
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
} from '@/components/ui/list-item';
import { PortalChipRow, type PortalChipDef } from '@/components/ui/portal-chip';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useLongPress as useSharedLongPress, HOLD_FILL_DELAY_MS } from '@/hooks/use-long-press';
import { learnItemPrice } from '@homeup/core';
import { timeAgo } from '@homeup/core';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

interface GroceryItemCardProps {
  item: GroceryItem;
  groupId: string;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  customAisles?: GroceryCustomAisle[];
  /** Typical price for this item's name from the shared library (fallback when the item has no price). */
  libraryPriceCents?: number | null;
  /** Typical shelf life for this item's name from the shared library (fallback when the item has no shelf_life_days of its own) — powers the have-it freshness meter. */
  resolvedShelfLifeDays?: number | null;
  onUpdate: (item: GroceryItem) => void;
  onRequestDelete: (item: GroceryItem) => void;
  /** Optional — when provided, the card shows an Archive action (learns the item
   *  to the library, then removes it). Omitted in reuse contexts (Home hub / global
   *  search) that don't wire the library-learn flow (FLUX-191). */
  onArchive?: (item: GroceryItem) => void;
  onEdit: (item: GroceryItem) => void;
  /** HOUP-317: "One list" mode shows the aisle as a colour dot instead of a
   *  text label (aisle headers are gone) — omitted in the aisle-grouped view,
   *  which already conveys aisle via its header. */
  showAisleDot?: boolean;
  /** Search results: a have/bought row gets a one-click "Need again" button. */
  showNeedAgain?: boolean;
}

// ── Unit-aware qty config ────────────────────────────────────────────────────
function getUnitStep(unit: string | null | undefined): number {
  const u = (unit ?? '').toLowerCase().trim();
  if (u === 'kg') return 0.5;
  if (u === 'g' || u === 'gram' || u === 'grams') return 50;
  if (u === 'l' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters') return 0.25;
  if (u === 'ml' || u === 'millilitre' || u === 'millilitres' || u === 'milliliter') return 50;
  return 1;
}

function getUnitMax(unit: string | null | undefined): number {
  const u = (unit ?? '').toLowerCase().trim();
  if (u === 'kg') return 50;
  if (u === 'g' || u === 'gram' || u === 'grams') return 5000;
  if (u === 'l' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters') return 20;
  if (u === 'ml' || u === 'millilitre' || u === 'millilitres' || u === 'milliliter') return 5000;
  return 999;
}

function roundQty(v: number, unit: string | null | undefined): number {
  const u = (unit ?? '').toLowerCase().trim();
  const isDecimal = u === 'kg' || u === 'l' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters';
  return isDecimal ? Math.round(v * 100) / 100 : Math.round(v);
}

// ── Vertical drag-to-adjust ──────────────────────────────────────────────────
// Drag a value chip up to increase / down to decrease. Returns a live preview
// while dragging and commits on release. `dragged` lets the caller suppress the
// click that would otherwise open the tap editor.
function useDragNumber(params: {
  current: number;
  step: number;
  min: number;
  max: number;
  round: (v: number) => number;
  commit: (v: number) => void;
}) {
  const { current, step, min, max, round, commit } = params;
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{ startY: number; start: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const PX_PER_STEP = 16; // pixels of travel per increment

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, start: current, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.startY - e.clientY; // up = positive
    if (!d.moved && Math.abs(dy) < 5) return;
    d.moved = true;
    dragged.current = true;
    e.preventDefault();
    const steps = Math.round(dy / PX_PER_STEP);
    setPreview(Math.max(min, Math.min(max, round(d.start + steps * step))));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (d?.moved && preview != null && preview !== current) commit(preview);
    setPreview(null);
  };

  return {
    preview,
    dragged,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

// ── Press-and-hold to open the overflow menu (FLUX-195 decision 9, "A′") ────
// Elements that own their own pointer interaction never start a hold — same
// exclusion list SwipeActions uses for swipe, since a bare `<button>` already
// covers the qty/price chips, the tap-circle, and the drag handle.
const NO_HOLD = 'button, input, textarea, select, a, label, [data-no-swipe]';

// FLUX-198: thin wrapper over the shared useLongPress (src/hooks/use-long-press.ts)
// that preserves this surface's own needs — the shared hook's timer/cancel/
// consumeClick logic is reused as-is, standardizing groceries onto the same
// LONG_PRESS_MS (500ms) every other hold surface uses (dropping the old 400ms):
//   - mouse pointers skip the hold entirely (desktop uses hover-⋯ / right-click)
//   - NO_HOLD targets (buttons, inputs, the drag handle…) never arm a hold
//   - onContextMenu opens the same menu (real long-press's native context-menu
//     fallback on touch, and desktop's intended right-click path)
//   - `pressing` (for the row's scale-down affordance) reuses the shared hook's
//     own progress/cancel tracking (`trackProgress`) instead of duplicating it
function useLongPress(onFire: () => void) {
  const { handlers: shared, consumeClick, progress } = useSharedLongPress(onFire, true, {
    trackProgress: true,
    fillDelayMs: HOLD_FILL_DELAY_MS,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return; // desktop: hover-⋯ / right-click instead of hold
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    shared.onPointerDown(e);
  }, [shared]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Real long-press on touch fires its own native contextmenu shortly after
    // ours already opened the sheet — suppress the iOS text-selection callout.
    // On desktop (mouse) this IS the intended right-click → menu path.
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    e.preventDefault();
    onFire();
  }, [onFire]);

  // Suppress the click that follows a fired hold (e.g. tapping-and-holding
  // the item name shouldn't also open the rename editor).
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (consumeClick()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [consumeClick]);

  return {
    pressing: progress > 0,
    progress,
    handlers: { onPointerDown, onContextMenu, onClickCapture },
  };
}

export function GroceryItemCard(props: GroceryItemCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <GroceryItemCardInner {...props} dragListeners={listeners} dragAttributes={attributes} />
    </div>
  );
}

// Standalone entry point for surfaces OUTSIDE the groceries page's DndContext
// (the Home hub widget + global search). Renders the exact same card, minus the
// `useSortable` wrapper — so no "must be used within a SortableContext" warning —
// and with the drag handle omitted (no drag listeners passed). All other
// interactions (swipe, qty/price, overflow menu, edit modal) behave identically.
export function GroceryItemCardStandalone(props: GroceryItemCardProps) {
  return <GroceryItemCardInner {...props} />;
}

function GroceryItemCardInner({
  item,
  groupId,
  groupMembers,
  memberProfiles,
  customAisles,
  libraryPriceCents,
  resolvedShelfLifeDays,
  onUpdate,
  onRequestDelete,
  onArchive,
  onEdit,
  showAisleDot,
  showNeedAgain,
  dragListeners,
  dragAttributes,
}: GroceryItemCardProps & { dragListeners?: object; dragAttributes?: object }) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(item.name);
  const [editingQty, setEditingQty] = useState(false);
  const [localQty, setLocalQty] = useState<number>(item.quantity ?? 1);
  const [editingPrice, setEditingPrice] = useState(false);
  const [localPrice, setLocalPrice] = useState<string>(item.price_cents != null ? String(item.price_cents / 100) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  // PC5/PC6: the recipe portal falls back to a neutral note sheet when the
  // item has no real recipe entity to navigate to (recipe_note without a
  // recipe_source_id — see the recipeChips construction below).
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const modules = useModules();
  // Modules: the recipe chip (and its note sheet) needs recipes and groceries (module-features.ts).
  const recipeLinked = modules.feature('recipes.groceries');
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingName]);

  // Keep localQty in sync when item updates externally (but not while editing)
  useEffect(() => {
    if (!editingQty) setLocalQty(item.quantity ?? 1);
  }, [item.quantity, editingQty]);

  // ── patchField: saves a field, does NOT close any editor ─────────────────
  // Persistence is delegated to the page's Legend-State store (FLUX-149): merge
  // the change onto the item locally and hand it up. The write is optimistic and
  // offline-durable; updated_by is stamped server-side by a DB trigger on sync.
  const patchField = useCallback(async (payload: Partial<GroceryItem>) => {
    onUpdate({ ...item, ...payload });
  }, [item, onUpdate]);

  // ── patch: wraps patchField with loading state and closes name editor ────
  const patch = useCallback(async (payload: Partial<GroceryItem>) => {
    setIsSaving(true);
    try {
      await patchField(payload);
    } finally {
      setIsSaving(false);
      setEditingName(false);
    }
  }, [patchField]);

  // ── Qty editor ────────────────────────────────────────────────────────────
  const openQtyEditor = () => {
    setLocalQty(item.quantity ?? 1);
    setEditingQty(true);
    setTimeout(() => qtyInputRef.current?.select(), 50);
  };

  const closeQtyEditor = useCallback(() => {
    setEditingQty(false);
    const rounded = roundQty(localQty, item.unit);
    if (rounded !== (item.quantity ?? 1) && !isNaN(rounded) && rounded >= 0) {
      void patchField({ quantity: rounded });
    }
  }, [localQty, item.quantity, item.unit, patchField]);

  const adjustQty = (delta: number) => {
    const next = Math.max(0, Math.min(getUnitMax(item.unit), localQty + delta));
    setLocalQty(roundQty(next, item.unit));
  };

  // Effective price = the item's own price, else the library's typical price for its name.
  const hasExplicitPrice = item.price_cents != null;
  const effectivePriceCents = item.price_cents ?? libraryPriceCents ?? null;

  // ── Price editor ────────────────────────────────────────────────────────────
  const openPriceEditor = () => {
    setLocalPrice(effectivePriceCents != null ? String(effectivePriceCents / 100) : '');
    setEditingPrice(true);
    setTimeout(() => priceInputRef.current?.select(), 50);
  };

  const closePriceEditor = useCallback(() => {
    setEditingPrice(false);
    const dollars = parseFloat(localPrice);
    const cents = isNaN(dollars) || dollars < 0 ? null : Math.round(dollars * 100);
    if (cents !== (item.price_cents ?? null)) {
      void patchField({ price_cents: cents });
      // Learn this price into the shared item library (typical price for this name)
      if (cents != null) void learnItemPrice(supabase, groupId, item.name, cents);
    }
  }, [localPrice, item.price_cents, patchField, groupId, item.name]);

  const am = getAisleMeta(item.aisle, customAisles);
  const bought = item.status === 'bought';
  const have = item.status === 'have';

  // ── Freshness meter (have-it rows) — draining bar from got-it toward
  //    estimated expiry. `null` when there's no got-it anchor (legacy rows)
  //    or no resolvable shelf life (own value, else the library default) —
  //    those rows render no bar. Elapsed time stays owned solely by the
  //    `have Nd` meta fragment below; this window only labels what's left.
  const effectiveShelfLifeDays = item.shelf_life_days ?? resolvedShelfLifeDays ?? null;
  const fw = have ? freshnessWindow(item.status_changed_at, effectiveShelfLifeDays) : null;

  // ── Disposition (swipe-driven): Needed / Got it (bought) / Have it ──────────
  const setDisposition = useCallback((target: GroceryItem['status']) => {
    const payload: Partial<GroceryItem> = { status: target, status_changed_at: new Date().toISOString() };
    if (target === 'bought') {
      const d = new Date();
      payload.last_purchased_at = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      payload.last_price = effectivePriceCents ?? null;
    } else {
      payload.last_purchased_at = null;
    }
    // FLUX-189: leaving 'needed' clears the ephemeral recipe note (never `notes`).
    Object.assign(payload, clearRecipeNoteOnLeaveNeeded(target));
    void patchField(payload);
  }, [patchField, effectivePriceCents]);

  const swipeRight = () => setDisposition(bought ? 'needed' : 'bought');
  const swipeLeft = () => setDisposition(have ? 'needed' : 'have');

  const qty = qtyLabel(item);
  // Qty only matters when it's not the default (1) and not empty (0) — a bare
  // "1" or "0" is noise regardless of whether a unit is set (Guy, 2026-07-12:
  // "any 1 must go, qty only matters when its different from 1 or 0").
  const qtyValue = item.quantity ?? 1;
  const showQty = qtyValue !== 1 && qtyValue !== 0;
  const emoji = getGroceryEmoji(item.name, item.aisle);
  const isAutoAdded = !!item.template_key || !!item.recurrence_days;

  // ── Hold-to-act (decision 9) — opens the overflow menu as a bottom sheet on
  //    touch; desktop keeps a hover-revealed ⋯ / right-click into the same menu. ─
  const longPress = useLongPress(() => setHoldMenuOpen(true));

  // ── Status-change timestamp, inline + short form (decision 5) — reflects
  //    ONLY the last status change (needed/bought/have). No `updated_at`
  //    fallback: that field moves on EVERY edit, so a price or qty tweak was
  //    bumping the shown time (Guy, 2026-07-12). `status_changed_at` is
  //    already the dedicated field — legacy rows without it show no time
  //    until their next status change, rather than a misleading one. ─────────
  const statusRel = timeAgo(item.status_changed_at);
  const statusShort = statusRel ? statusRel.replace(/ ago$/, '') : null;

  // ── Meta grammar (Hearth §6 tenant matrix): "qty · need-by, or have ·
  //    shelf-life" — built as an ordered list of optional fragments joined by
  //    a single middle dot each (H6), same idiom as costs/cost-card.tsx. ─────
  // Disposition word — "bought"/"have" read as the row's status fragment;
  // 'needed' contributes nothing here (no dedicated per-item due date exists
  // in the schema yet, so there's no literal "need-by" fragment to show).
  const dispositionWord = bought ? (
    <span className="flex items-center gap-1">
      <Check className="h-3 w-3 text-success" />
      bought{statusShort ? ` ${statusShort}` : ''}
    </span>
  ) : have ? (
    <span className="flex items-center gap-1">
      <PackageCheck className="h-3 w-3" />
      have{statusShort ? ` ${statusShort}` : ''}
    </span>
  ) : null;

  // Expiry — the item's own actual expiry date (once purchased), distinct
  // from the shelf-life estimate below. Relative, never raw ISO (H6).
  const expiryDays = item.expiry_date ? daysUntilISO(item.expiry_date) : null;
  const expiryMeta = expiryDays != null ? (
    <span
      className={cn(
        'flex items-center gap-1',
        expiryDays < 0 ? 'text-destructive' : expiryDays <= 3 ? 'text-warning' : undefined
      )}
      title={`Expiry date: ${item.expiry_date}`}
    >
      <CalendarClock className="h-3 w-3" />
      {expiryDays < 0 ? `expired ${Math.abs(expiryDays)}d ago` : expiryDays === 0 ? 'expires today' : `expires ${expiryDays}d`}
    </span>
  ) : null;

  // FLUX-189: recipe note/source — the row's one portal (PC1-6). A real
  // recipe entity + route exist (`/recipes/[id]`, recipe_source_id is the
  // soft link set alongside recipe_note whenever a recipe pushes an
  // ingredient onto the list — see addIngredientToList in
  // src/app/recipes/[id]/page.tsx). When that link is present the chip is
  // accent (PC5: leaves the section) and navigates there; the rare legacy/
  // defensive case of a note with no source id falls back to a neutral chip
  // that opens the note text in a bottom sheet instead of inventing a route.
  const hasRecipeRoute = !!item.recipe_source_id;
  const recipeChips: PortalChipDef[] = recipeLinked && item.recipe_note
    ? [
        {
          key: 'recipe',
          icon: <ChefHat className="h-3.5 w-3.5" />,
          label: item.recipe_note,
          tone: hasRecipeRoute ? 'accent' : 'neutral',
          // Hearth §8.1 portal jump: shares this name with the recipe
          // detail page's title (recipes/[id]/page.tsx) so supported
          // browsers morph the chip into the destination header.
          morphName: hasRecipeRoute ? `portal-recipe-${item.recipe_source_id}` : undefined,
          onOpen: () => {
            if (hasRecipeRoute) {
              runNavTransition('portal', () => router.push(`/recipes/${item.recipe_source_id}`));
            } else {
              setNoteSheetOpen(true);
            }
          },
        },
      ]
    : [];

  // ── Unified card ──────────────────────────────────────────────────────────
  const allAisles = [
    ...AISLE_ORDER.map((a) => ({ id: a, label: getAisleMeta(a).label, dot: getAisleColor(a).dot })),
    ...(customAisles ?? []).map((a) => ({ id: a.name, label: a.name, dot: getAisleColor(a.name, customAisles).dot })),
  ];

  // Hearth §13.7 "Row menu": right-click with a mouse. The status changes
  // lead, then who and where, then the item's own settings; touch keeps the
  // hold sheet below.
  const rowMenu = useRowContextMenu(() => ({
    title: item.name,
    kind: 'Grocery item',
    actions: [
      !bought && { id: 'bought', label: 'Got it', group: 'state', icon: 'done', run: () => setDisposition('bought') },
      !have && { id: 'have', label: 'Have it', group: 'state', icon: 'hide', run: () => setDisposition('have') },
      item.status !== 'needed' && { id: 'needed', label: 'Need it again', group: 'state', icon: 'undo', run: () => setDisposition('needed') },
      {
        id: 'assign',
        label: 'Assign',
        group: 'set',
        icon: 'assign',
        value: item.assigned_to ? memberLabel(item.assigned_to, memberProfiles) : undefined,
        options: [
          { id: 'none', label: 'Unassigned', checked: !item.assigned_to, run: () => void patch({ assigned_to: null }) },
          ...groupMembers.map((m) => ({
            id: m.user_id,
            label: memberLabel(m.user_id, memberProfiles),
            checked: item.assigned_to === m.user_id,
            run: () => void patch({ assigned_to: m.user_id }),
          })),
        ],
      },
      {
        id: 'aisle',
        label: 'Move to aisle',
        group: 'set',
        icon: 'move',
        value: am.label,
        options: allAisles.map((a) => ({
          id: a.id,
          label: a.label,
          swatch: a.dot,
          checked: item.aisle === a.id,
          run: () => {
            if (a.id !== item.aisle) void patch({ aisle: a.id });
          },
        })),
      },
      {
        id: 'essential',
        label: item.is_essential ? 'Not essential' : 'Mark essential',
        group: 'edit',
        icon: 'star',
        run: () => void patch({ is_essential: !item.is_essential }),
      },
      { id: 'edit', label: 'Edit details', group: 'edit', icon: 'edit', run: () => onEdit(item) },
      onArchive && { id: 'archive', label: 'Archive', group: 'danger', icon: 'archive', run: () => onArchive(item) },
      { id: 'delete', label: 'Delete', group: 'danger', icon: 'delete', danger: true, run: () => onRequestDelete(item) },
    ],
  }));

  // ── Drag-to-adjust qty & price ──────────────────────────────────────────────
  const qtyDrag = useDragNumber({
    current: item.quantity ?? 1,
    step: getUnitStep(item.unit),
    min: 0,
    max: getUnitMax(item.unit),
    round: (v) => roundQty(v, item.unit),
    commit: (v) => void patchField({ quantity: v }),
  });
  const priceDrag = useDragNumber({
    current: (effectivePriceCents ?? 0) / 100,
    step: 0.5,
    min: 0,
    max: 9999,
    round: (v) => Math.round(v * 100) / 100,
    commit: (v) => {
      const cents = Math.round(v * 100);
      void patchField({ price_cents: cents });
      void learnItemPrice(supabase, groupId, item.name, cents);
    },
  });
  const qtyDisplay = qtyDrag.preview != null
    ? (item.unit ? `${qtyDrag.preview} ${item.unit}` : String(qtyDrag.preview))
    : qty;
  const priceDisplayCents = priceDrag.preview != null ? Math.round(priceDrag.preview * 100) : effectivePriceCents;

  // ── Status-aware swipe configs (reverse swipes read as "undo") ───────────────
  const rightCfg = bought
    ? { bg: 'bg-muted-foreground/70', activeBg: 'bg-muted-foreground', icon: <RotateCcw className="h-5 w-5 text-white" />, label: 'Needed' }
    : { bg: 'bg-success/70', activeBg: 'bg-success', icon: <Check className="h-5 w-5 text-white" />, label: 'Got it' };
  const leftCfg = have
    ? { bg: 'bg-muted-foreground/70', activeBg: 'bg-muted-foreground', icon: <RotateCcw className="h-5 w-5 text-white" />, label: 'Needed' }
    : { bg: 'bg-primary/70', activeBg: 'bg-primary', icon: <PackageCheck className="h-5 w-5 text-white" />, label: 'Have it' };

  // ── Inline qty editor (shared between row + subline) ────────────────────────
  const qtyEditor = (
    <div
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeQtyEditor();
      }}
      className="flex items-center gap-0.5 bg-popover ring-1 ring-border rounded-full px-1 py-0.5 shadow-xl"
    >
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => adjustQty(-getUnitStep(item.unit))}
        className="h-6 w-6 grid place-items-center rounded-full text-muted-foreground hover:bg-muted flex-shrink-0 transition-colors"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        ref={qtyInputRef}
        type="number"
        value={localQty}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= 0) setLocalQty(v);
        }}
        inputMode="decimal"
        min={0}
        max={getUnitMax(item.unit)}
        step={getUnitStep(item.unit)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); adjustQty(getUnitStep(item.unit)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); adjustQty(-getUnitStep(item.unit)); }
          if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur();
        }}
        className="w-11 text-center bg-transparent text-foreground text-sm font-medium tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {item.unit && (
        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 px-0.5">{item.unit}</span>
      )}
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => adjustQty(getUnitStep(item.unit))}
        className="h-6 w-6 grid place-items-center rounded-full text-muted-foreground hover:bg-muted flex-shrink-0 transition-colors"
      >
        <Plus className="h-3 w-3" />
      </button>
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(e) => e.preventDefault()}
        onClick={closeQtyEditor}
        className="h-6 w-6 grid place-items-center rounded-full text-primary hover:bg-muted flex-shrink-0 transition-colors"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // ── Inline price editor ─────────────────────────────────────────────────────
  const priceEditor = (
    <div
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) closePriceEditor();
      }}
      className="flex items-center gap-0.5 bg-popover ring-1 ring-border rounded-full px-2 py-0.5 shadow-xl"
    >
      <span className="text-xs text-muted-foreground flex-shrink-0">{currencySymbol()}</span>
      <input
        ref={priceInputRef}
        type="number"
        value={localPrice}
        onChange={(e) => setLocalPrice(e.target.value)}
        inputMode="decimal"
        min={0}
        step={0.01}
        autoFocus
        placeholder="0.00"
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur();
        }}
        className="w-14 text-center bg-transparent text-foreground text-sm font-medium tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(e) => e.preventDefault()}
        onClick={closePriceEditor}
        className="h-6 w-6 grid place-items-center rounded-full text-primary hover:bg-muted flex-shrink-0 transition-colors"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // ── Meta line (H6/PC): qty edit-chip, then the dot-joined optional
  //    fragments — only present ones contribute a dot (mirrors
  //    costs/cost-card.tsx's metaParts idiom). ─────────────────────────────────
  const metaParts: React.ReactNode[] = [];
  // The editor also opens from the hover "+ qty" on a quantity of 1, which shows no chip.
  if (showQty || editingQty) {
    metaParts.push(
      editingQty ? (
        <span key="qty">{qtyEditor}</span>
      ) : (
        <button
          key="qty"
          data-no-swipe
          {...qtyDrag.handlers}
          onClick={() => { if (!qtyDrag.dragged.current) openQtyEditor(); }}
          className={cn(
            'rounded px-0.5 -mx-0.5 touch-none select-none cursor-ns-resize font-medium tabular-nums transition-colors',
            qtyDrag.preview != null ? 'text-primary' : 'text-foreground hover:text-primary'
          )}
          title="Tap to edit · drag up/down to adjust quantity"
        >
          {qtyDisplay}
        </button>
      )
    );
  }
  if (dispositionWord) metaParts.push(<span key="disposition">{dispositionWord}</span>);
  // Dropped when the freshness meter renders below — it already conveys the
  // shelf-life estimate, so the plain-text figure would be redundant.
  if (item.shelf_life_days && !fw) {
    metaParts.push(
      <span key="shelf" className="flex items-center gap-1" title="Estimated shelf life">
        ~{item.shelf_life_days}d
      </span>
    );
  }
  if (expiryMeta) metaParts.push(<span key="expiry">{expiryMeta}</span>);
  if (item.notes) {
    metaParts.push(
      <span key="notes" className="truncate max-w-[10rem]" title={item.notes}>
        {item.notes}
      </span>
    );
  }

  return (
    <>
      <SwipeActions
        onSwipeRight={swipeRight}
        onSwipeLeft={swipeLeft}
        right={rightCfg}
        left={leftCfg}
      >
        <ListItem
          holdProgress={longPress.progress}
          {...withRowMenu(longPress.handlers, rowMenu)}
          className={cn(
            'items-center gap-2.5 py-2.5 pr-2.5 pl-3 transition-[opacity,transform,background-color] duration-200 select-none [-webkit-touch-callout:none]',
            // Hearth v2 (H2/H4): the FLUX-1559 whole-row tints are gone; inside
            // the one bordered list card they read as nested cards, and the
            // have-it tint put coral on a non-interactive block. Got it keeps
            // the §6 done treatment (55% + strikethrough + check badge); Have
            // it reads from its muted title, glyph and "have" meta.
            bought && 'opacity-[.55]',
            longPress.pressing && 'scale-[0.97]'
          )}
        >
          <ListItemLeading>
            <span className={cn('inline-flex select-none', have && 'opacity-75')} title={am.label}>
              <GroceryGlyph emoji={emoji} size={24} />
            </span>
            {/* Done treatment (Hearth §6): a check badge on the leading chip —
                the emoji itself stays put (content exception, FLUX-271 plan). */}
            {bought && (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-success-foreground ring-2 ring-card"
              >
                <Check className="h-2.5 w-2.5" />
              </span>
            )}
            {/* Essential — a small dot on the leading chip rather than a
                whole-row tint (H2: status hues in small doses only). */}
            {item.is_essential && !bought && (
              <span
                aria-hidden
                title="Essential"
                className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-card"
              />
            )}
          </ListItemLeading>

          <ListItemContent>
            <ListItemTitle>
              {editingName ? (
                <input
                  ref={inputRef}
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nameValue.trim()) patch({ name: nameValue.trim() });
                    if (e.key === 'Escape') { setEditingName(false); setNameValue(item.name); }
                  }}
                  onBlur={() => {
                    if (nameValue.trim() && nameValue !== item.name) patch({ name: nameValue.trim() });
                    else setEditingName(false);
                  }}
                  className="min-w-0 flex-1 bg-popover ring-1 ring-border rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              ) : (
                <span
                  onClick={() => { setEditingName(true); setNameValue(item.name); }}
                  className={cn(
                    'truncate cursor-text transition-colors',
                    bought ? 'text-muted-foreground line-through' : have ? 'text-muted-foreground' : 'text-foreground'
                  )}
                  title="Tap to rename"
                >
                  {item.name}
                </span>
              )}
            </ListItemTitle>

            <ListItemMeta>
              {showAisleDot && (
                <span className="inline-flex flex-shrink-0 items-center">
                  <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', getAisleColor(item.aisle, customAisles).dot)} />
                  <span className="sr-only">{am.label}</span>
                </span>
              )}
              {metaParts.flatMap((part, i) =>
                i === 0
                  ? [part]
                  : [
                      <span key={`dot-${i}`} aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>,
                      part,
                    ]
              )}
              {/* Qty — edit control, not a resting pill (kept per plan decision):
                  hidden at the default (1), a hover-only affordance adds it. */}
              {!showQty && !editingQty && (
                <button
                  data-no-swipe
                  onClick={openQtyEditor}
                  className="hidden items-center gap-1 text-muted-foreground transition-colors hover:text-foreground sm:group-hover/list-item:flex"
                  title="Add quantity"
                >
                  <Plus className="h-3 w-3" />
                  qty
                </button>
              )}
              {isAutoAdded && (
                <span title="Auto-replenish item" className="flex items-center text-muted-foreground/70">
                  <RefreshCw className="h-3 w-3" />
                </span>
              )}
            </ListItemMeta>

            {/* Freshness meter (have-it rows) — a thin local bar draining from
                got-it toward estimated expiry, second content line. Fill =
                remaining freshness (full at got-it, empty at/after expiry);
                the label shows only what's left ("~Nd left" / "expired ~Nd
                ago") — elapsed time is already the `have Nd` meta fragment
                above, so it isn't repeated here (H2/H6). */}
            {fw && (
              <div className="flex items-center gap-2 pt-0.5">
                {/* H3 deviation approved in HOUP-285 (row-wide freshness
                    meter, mobile parity), at the H3 3px height. */}
                <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      fw.overdue ? 'bg-destructive' : fw.fraction >= 2 / 3 ? 'bg-warning' : 'bg-success'
                    )}
                    style={{ width: `${(1 - fw.fraction) * 100}%` }}
                  />
                </div>
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    fw.overdue ? 'text-destructive' : fw.fraction >= 2 / 3 ? 'text-warning' : 'text-muted-foreground'
                  )}
                >
                  {fw.overdue ? `expired ~${Math.abs(fw.remainingDays)}d ago` : `~${fw.remainingDays}d left`}
                </span>
              </div>
            )}

            {/* Portal (PC1-6): the recipe this item was added from, when one
                exists — the row's second content line. */}
            {recipeChips.length > 0 && <PortalChipRow chips={recipeChips} />}
          </ListItemContent>

          <ListItemTrailing className="gap-1">
            {showNeedAgain && item.status !== 'needed' && (
              <button
                onClick={(e) => { e.stopPropagation(); setDisposition('needed'); }}
                aria-label={`Need ${item.name} again`}
                className="min-h-[32px] rounded-full border border-primary/30 bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/15 transition-colors"
              >
                Need again
              </button>
            )}
            {/* Assignee — desktop only inline; mobile reaches it via the
                "Assign to" section in the hold/⋯ menu below. */}
            <div className="hidden sm:block">
              <AssigneePicker
                value={item.assigned_to}
                groupMembers={groupMembers}
                memberProfiles={memberProfiles}
                disabled={isSaving}
                onChange={(uid) => patch({ assigned_to: uid || null })}
              />
            </div>

            {/* Est price — the row's trailing value; edit control (tap to
                edit, drag to adjust — kept per plan decision, not a resting pill). */}
            {editingPrice ? priceEditor : (
              <button
                data-no-swipe
                {...priceDrag.handlers}
                onClick={() => { if (!priceDrag.dragged.current) openPriceEditor(); }}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2 py-1 touch-none select-none cursor-ns-resize transition-colors',
                  priceDrag.preview != null ? 'bg-primary/15' : 'hover:bg-muted'
                )}
                title={
                  effectivePriceCents == null
                    ? 'Tap to add price · drag up/down to adjust'
                    : hasExplicitPrice
                      ? 'Tap to edit · drag up/down to adjust price'
                      : 'Estimated from library: tap to confirm · drag to adjust'
                }
              >
                {priceDisplayCents != null ? (
                  // H2/H6: a price is a value, not a status: muted tabular,
                  // an estimate one step quieter behind its "~".
                  <span className={cn('text-sm font-medium tabular-nums', hasExplicitPrice || priceDrag.preview != null ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
                    {hasExplicitPrice || priceDrag.preview != null ? '' : '~'}{formatMoney(priceDisplayCents)}
                  </span>
                ) : (
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            )}

            {/* Overflow menu — mobile never renders this trigger (hold opens the
                same menu as a bottom sheet); desktop gets a hover-revealed ⋯
                (and right-click, wired via longPress.handlers above). */}
            <PopMenu
              align="right"
              width="w-44"
              open={holdMenuOpen}
              onOpenChange={setHoldMenuOpen}
              mobileSheet
              previewContent={
                <>
                  <GroceryGlyph emoji={emoji} size={20} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {item.name}
                    {showQty && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{qty}</span>}
                  </span>
                  {priceDisplayCents != null && (
                    <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                      {hasExplicitPrice ? '' : '~'}{formatMoney(priceDisplayCents)}
                    </span>
                  )}
                </>
              }
              triggerClassName="hidden sm:flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors pointer-fine:opacity-0 pointer-fine:group-hover/list-item:opacity-100 pointer-fine:focus-visible:opacity-100"
              triggerLabel="More actions"
              trigger={<MoreHorizontal className="h-4 w-4" />}
            >
              {(close) => (
                <>
                  {/* Mark as — top of the menu (Guy, 2026-07-12): the row's own
                      status button is gone (the leading badge is the only
                      indicator now), so this + swipe are the two ways to
                      change disposition. Most-used section, so it's first. */}
                  <MenuLabel>Mark as</MenuLabel>
                  <MenuItem
                    active={item.status === 'needed'}
                    icon={<Circle className="h-3.5 w-3.5" />}
                    onClick={() => { setDisposition('needed'); close(); }}
                  >
                    Needed
                  </MenuItem>
                  <MenuItem
                    active={bought}
                    icon={<Check className="h-3.5 w-3.5 text-success" />}
                    onClick={() => { setDisposition('bought'); close(); }}
                  >
                    Bought
                  </MenuItem>
                  <MenuItem
                    active={have}
                    icon={<PackageCheck className="h-3.5 w-3.5 text-primary" />}
                    onClick={() => { setDisposition('have'); close(); }}
                  >
                    Have it
                  </MenuItem>
                  <MenuItem
                    active={!!item.is_essential}
                    icon={<Star className={cn('h-3.5 w-3.5', item.is_essential && 'fill-warning text-warning')} />}
                    onClick={() => { patch({ is_essential: !item.is_essential }); close(); }}
                  >
                    {item.is_essential ? 'Essential' : 'Mark essential'}
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { onEdit(item); close(); }}>
                    Edit details
                  </MenuItem>
                  {onArchive && (
                    <MenuItem icon={<Archive className="h-3.5 w-3.5" />} onClick={() => { onArchive(item); close(); }}>
                      Archive
                    </MenuItem>
                  )}
                  <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { onRequestDelete(item); close(); }}>
                    Delete
                  </MenuItem>
                  <MenuDivider />
                  {/* Assign to — second from the bottom (Guy, 2026-07-12). */}
                  <MenuLabel>Assign to</MenuLabel>
                  <MenuItem
                    active={!item.assigned_to}
                    icon={<UserPlus className="h-3.5 w-3.5" />}
                    onClick={() => { patch({ assigned_to: null }); close(); }}
                  >
                    Unassigned
                  </MenuItem>
                  {groupMembers.map((m) => (
                    <MenuItem
                      key={m.user_id}
                      active={item.assigned_to === m.user_id}
                      icon={
                        <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-foreground uppercase">
                          {memberLabel(m.user_id, memberProfiles).charAt(0)}
                        </span>
                      }
                      onClick={() => { patch({ assigned_to: m.user_id }); close(); }}
                    >
                      {memberLabel(m.user_id, memberProfiles)}
                    </MenuItem>
                  ))}
                  <MenuDivider />
                  {/* Move to aisle — bottom-most (Guy, 2026-07-12): longest,
                      least-frequently-changed list, so it goes last. */}
                  <MenuLabel>Move to aisle</MenuLabel>
                  {allAisles.map((a) => (
                    <MenuItem
                      key={a.id}
                      active={item.aisle === a.id}
                      icon={<span className={cn('h-2.5 w-2.5 rounded-full', a.dot)} />}
                      onClick={() => { if (a.id !== item.aisle) patch({ aisle: a.id }); close(); }}
                    >
                      {a.label}
                    </MenuItem>
                  ))}
                </>
              )}
            </PopMenu>

            {/* Drag handle — desktop only; mobile reorders via the board, not a tiny grip.
                Omitted entirely in standalone mode (no drag listeners passed), so the
                card is safe to render outside a SortableContext (hub / global search). */}
            {dragListeners && (
              <button
                {...(dragAttributes ?? {})}
                {...dragListeners}
                className="hidden sm:grid place-items-center h-9 w-6 text-muted-foreground/60 hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
                title="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            )}
          </ListItemTrailing>
        </ListItem>
      </SwipeActions>
      {rowMenu.menu}

      {/* PC5/PC6 fallback: a recipe note with no real recipe entity to link to
          opens its text in a neutral bottom sheet instead of inventing a route. */}
      {recipeLinked && !hasRecipeRoute && item.recipe_note && (
        <BottomSheet
          open={noteSheetOpen}
          onOpenChange={setNoteSheetOpen}
          className="z-[60] mx-auto max-w-md rounded-t-2xl border border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1 shadow-2xl shadow-black/50"
        >
          <div className="flex items-center gap-2 pb-2 text-sm font-medium text-foreground">
            <ChefHat className="h-4 w-4 text-muted-foreground" />
            Recipe note
          </div>
          <p className="pb-2 text-sm text-muted-foreground">{item.recipe_note}</p>
        </BottomSheet>
      )}
    </>
  );
}
