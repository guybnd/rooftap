'use client';

// ── FLUX-155 / FLUX-194: workable Groceries widget for the hub ──────────────────
// Renders the SAME full GroceryItemCard as the /groceries page (via
// GroceryItemCardStandalone) directly on the tile — same chips, swipe actions, qty/
// price, and edit modal — instead of a bespoke mini-row (FLUX-191). The card set the
// tile shows (FLUX-194):
//   • Needed 'essential' (starred) items — ALWAYS shown as cards.
//   • Every needed item — when the list is small (< core HOME_GROCERY_EXPAND_THRESHOLD),
//     so the whole shopping list is visible at a glance.
//   • When the list is large, only the essential cards render, and the remaining
//     needed items collapse to a compact chip summary + a link to /groceries.
// Items bought today and rows just marked 'have' from the hub linger ~10s then fade
// out gracefully (undo during the linger). Autocomplete quick-add stays at the top;
// tapping the tile chrome opens the full /groceries page.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { ChevronRight, Plus, ShoppingCart, Star } from 'lucide-react';
import { HOME_RE_ADD_CHIP_CAP, type Group, type GroceryItem } from '@homeup/core';
import { dialog } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { countNeeded, findGroceryByName, groceryNeededAgainPatch, homeGroceryRows, suggestReAdd, groceryItems$, useReconnectSync, useStoreHelpers, learnItemLibrary, resolveItemDefaults } from '@homeup/core';
import { createClient } from '@/lib/supabase/client';
import { toastUndoAction } from '@/lib/undo-toast';
import { useSuggestDismiss } from '@/app/groceries/use-suggest-dismiss';
import { useGroceryUndo } from '@/app/groceries/use-grocery-undo';
import { GroceryItemModal } from '@/app/groceries/grocery-item-modal';
import { GroceryItemCardStandalone } from '@/app/groceries/grocery-item-card';
import { ReAddSuggestions } from '@/app/groceries/re-add-suggestions';
import { useGroceryAux } from '@/app/groceries/use-grocery-aux';
import { HUB, HubTile, TileHeader, stopNav, localDateISO } from './hub-shared';

const FADE_MS = 600; // fade-out animation length inside the 10s linger window

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
  const { groupMembers, memberProfiles } = useDataCache();
  const { customAisles, libMap, priceFor } = useGroceryAux(group.id);
  const items$ = groceryItems$(group.id);
  useReconnectSync(items$);
  const { writeRow: writeItem, patchRow: patchItem, softDeleteRow: softDeleteItem } =
    useStoreHelpers(items$, currentUserId);

  const allItems = use$(() =>
    Object.values(items$.get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted)
  );
  const needed = countNeeded(allItems);
  const today = localDateISO(new Date());

  // Re-add suggestions (FLUX-207): 'have' items whose shelf life has passed,
  // as the same chips as /groceries with a smaller cap; Show more and Full
  // review reveal the rest.
  const reAddSuggestions = suggestReAdd(allItems, libMap);
  const groceryUndo = useGroceryUndo(patchItem);
  // Archive from a suggestion: off the list now with an Undo pill; the item's
  // details are learned into the library only if the pill lapses, matching
  // /groceries' Archive (FLUX-188).
  const archiveReAddItem = (item: GroceryItem) => {
    softDeleteItem(item.id);
    let undone = false;
    toastUndoAction('Item archived to library', () => {
      undone = true;
      patchItem(item.id, { deleted: false });
    });
    setTimeout(() => {
      if (undone) return;
      const defaults = resolveItemDefaults(item.name, libMap);
      void learnItemLibrary(createClient(), group.id, item.name, {
        shelf_life_days: item.shelf_life_days ?? defaults.days,
        typical_price_cents: item.price_cents ?? defaults.priceCents,
        aisle: item.aisle,
      });
    }, 4500);
  };
  const suggestDismiss = useSuggestDismiss({ hide: groceryUndo.hide, archive: archiveReAddItem });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | undefined>();

  // 'have' rows marked from the hub linger before fading out. 'visible' → shown,
  // 'fading' → running the fade-out transition, absent → gone from the list.
  const [lingerState, setLingerState] = useState<Record<string, 'visible' | 'fading'>>({});
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());

  const clearTimers = (id: string) => {
    (timers.current.get(id) ?? []).forEach(clearTimeout);
    timers.current.delete(id);
  };
  const startLinger = (id: string) => {
    clearTimers(id);
    setLingerState((s) => ({ ...s, [id]: 'visible' }));
    const t1 = setTimeout(
      () => setLingerState((s) => ({ ...s, [id]: 'fading' })),
      HUB.HAVE_LINGER_MS - FADE_MS
    );
    const t2 = setTimeout(() => {
      setLingerState((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      clearTimers(id);
    }, HUB.HAVE_LINGER_MS);
    timers.current.set(id, [t1, t2]);
  };
  const cancelLinger = (id: string) => {
    clearTimers(id);
    setLingerState((s) => {
      if (!(id in s)) return s;
      const next = { ...s };
      delete next[id];
      return next;
    });
  };
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((arr) => arr.forEach(clearTimeout));
  }, []);

  // The full GroceryItemCard drives status changes itself (via its own swipe /
  // circle-toggle handlers → onUpdate). We only reconcile the hub's linger-fade:
  // when a card transitions INTO 'have' from the hub, start the ~10s linger so the
  // row fades out gracefully (undo mid-linger swaps it back and cancels the fade).
  const onCardUpdate = (prev: GroceryItem, next: GroceryItem) => {
    writeItem(next);
    const wasHave = prev.status === 'have';
    const nowHave = next.status === 'have';
    if (nowHave && !wasHave) startLinger(next.id);
    else if (!nowHave && wasHave) cancelLinger(next.id);
  };

  const handleQuickAdd = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    const existing = findGroceryByName(allItems, name);
    if (existing) {
      // Re-flag an existing item to Needed instead of creating a duplicate.
      if (existing.status !== 'needed') {
        cancelLinger(existing.id);
        patchItem(existing.id, groceryNeededAgainPatch(new Date().toISOString()));
      }
      return;
    }
    const now = new Date().toISOString();
    writeItem({
      id: crypto.randomUUID(),
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
      created_by: currentUserId ?? null,
      updated_by: null,
      created_at: now,
      updated_at: now,
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

  // ── Which line-item cards the tile renders (FLUX-194) ─────────────────────────
  // Core homeGroceryRows: a short list shows every needed item and today's
  // buys; a long one shows the essentials and sums up the rest as chips.
  // Lingering 'have' rows (mid fade-out) stay on the card.
  const { showFullList, cardItems, overflowNames } = homeGroceryRows(allItems, {
    expanded,
    today,
    lingering: new Set(Object.keys(lingerState)),
  });

  const names = Array.from(new Set(allItems.map((i) => i.name))).sort();

  // Tapping the tile chrome (not a card / quick-add / link) opens the full page.
  const activate = () => router.push('/groceries');

  return (
    <HubTile
      onActivate={activate}
      ariaLabel="Groceries"
      className="lg:col-span-2"
    >
      <TileHeader
        sectionId="groceries"
        Icon={ShoppingCart}
        title="Groceries"
        right={
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
            {needed} needed
          </span>
        }
      />

      <div className="flex flex-col gap-3">
        <GroceryQuickAddHub names={names} onAdd={handleQuickAdd} />

        {/* Re-add suggestions (FLUX-207): collapses on its own when nothing is due. */}
        {reAddSuggestions.length > 0 && (
          <div {...stopNav}>
            <ReAddSuggestions
              runningLow={reAddSuggestions}
              cap={HOME_RE_ADD_CHIP_CAP}
              onAdd={(item) => groceryUndo.needAgain(item)}
              onAddAll={() => groceryUndo.needAgain(reAddSuggestions)}
              onSnooze={groceryUndo.snooze}
              dismissAction={suggestDismiss.dismissAction}
              onDismiss={suggestDismiss.dismiss}
            />
          </div>
        )}

        {cardItems.length === 0 && overflowNames.length === 0 && reAddSuggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing on the shopping list. Remember to add something.</p>
        )}
        {(cardItems.length > 0 || overflowNames.length > 0) && (
          <>
            {/* When the list is too big to show inline, the starred cards read as
                "your must-grabs" above the summarised remainder. */}
            {!showFullList && cardItems.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Star className="h-3 w-3 fill-current text-warning" /> Essentials to grab
              </span>
            )}

            {cardItems.length > 0 && (
              <div className="space-y-1.5">
                {cardItems.map((item) => (
                  <div
                    key={item.id}
                    {...stopNav}
                    className="overflow-hidden transition-all duration-500"
                    style={
                      lingerState[item.id] === 'fading'
                        ? { opacity: 0, maxHeight: 0 }
                        : { opacity: 1, maxHeight: 240 }
                    }
                  >
                    <GroceryItemCardStandalone
                      item={item}
                      groupId={group.id}
                      groupMembers={groupMembers}
                      memberProfiles={memberProfiles}
                      customAisles={customAisles}
                      libraryPriceCents={priceFor(item.name)}
                      onUpdate={(next) => onCardUpdate(item, next)}
                      onRequestDelete={async (it) => {
                        if (await dialog.confirm({ title: `Remove “${it.name}” from the list?`, confirmLabel: 'Remove', destructive: true })) {
                          softDeleteItem(it.id);
                        }
                      }}
                      onEdit={(it) => {
                        setEditingItem(it);
                        setModalOpen(true);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Remaining needed items (large list only) — compact name-chip summary. */}
            {overflowNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {overflowNames.slice(0, 6).map((n) => (
                  <span key={n} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {n}
                  </span>
                ))}
                {overflowNames.length > 6 && (
                  <span className="rounded-full px-2.5 py-1 text-xs text-muted-foreground">
                    +{overflowNames.length - 6} more
                  </span>
                )}
              </div>
            )}
          </>
        )}

        <div {...stopNav} className="flex items-center justify-end">
          <button
            onClick={() => router.push('/groceries')}
            className="inline-flex min-h-[44px] items-center gap-1 px-1 text-sm font-medium text-primary hover:text-primary/80"
          >
            Open groceries
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Full item editor (long-press) — persists via the same store write as /groceries */}
      <div {...stopNav}>
        <GroceryItemModal
          key={editingItem?.id ?? 'none'}
          isOpen={modalOpen}
          item={editingItem}
          groupId={group.id}
          onClose={() => {
            setModalOpen(false);
            setEditingItem(undefined);
          }}
          onSave={(saved) => {
            writeItem(saved);
            setModalOpen(false);
            setEditingItem(undefined);
          }}
        />
      </div>
    </HubTile>
  );
}

function GroceryQuickAddHub({ names, onAdd }: { names: string[]; onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName('');
  };
  return (
    <div
      {...stopNav}
      className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 focus-within:border-ring"
    >
      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        type="text"
        list="hub-grocery-names"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Add to the list…"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
      />
      <datalist id="hub-grocery-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {name.trim() && (
        <button onClick={submit} className="shrink-0 text-xs font-medium text-primary hover:text-primary/80">
          Add
        </button>
      )}
    </div>
  );
}
