'use client';

// FLUX-207: "Suggest re-add" — items marked 'Have it' whose shelf life has
// passed. Shared row used by both the /groceries list section and the Home
// hub card so + Add / Snooze / Dismiss behave identically on both surfaces.
// Dismiss (X) is for one-offs: it runs the user's remembered choice (Not now
// or Archive, see core's grocery-dismiss.ts), asking once via DismissMenu when
// none is stored yet (use-suggest-dismiss.ts).

import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Star, X } from 'lucide-react';
import type { GroceryDismissAction, SuggestReAddItem } from '@homeup/core';
import { GroceryGlyph } from '@/components/grocery-glyph';
import { GROCERY_DISMISS_ACTIONS, GROCERY_DISMISS_LABELS, GROCERY_SUGGEST_CAP, getGroceryEmoji } from '@homeup/core';
import { SnoozeMenu } from './snooze-menu';
import { PopMenu, MenuItem, MenuLabel } from '../setup/pop-menu';
import { cn } from '@/lib/utils';

/** One suggestion row: name + "Xd past shelf life" + Add / Snooze / Dismiss actions. */
export function SuggestReAddRow({
  item,
  onAdd,
  onSnooze,
  dismissAction,
  onDismiss,
}: {
  item: SuggestReAddItem;
  onAdd: () => void;
  onSnooze: (untilISO: string) => void;
  /** The remembered X choice; null = ask with DismissMenu first. */
  dismissAction: GroceryDismissAction | null;
  onDismiss: (action: GroceryDismissAction) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
      <GroceryGlyph emoji={getGroceryEmoji(item.name, item.aisle)} size={20} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {item.is_essential && (
            <Star className="h-3 w-3 flex-shrink-0 fill-warning text-warning" />
          )}
          <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">{item.daysOverdue}d past shelf life</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={onAdd}
          className="flex items-center gap-1 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
        <SnoozeMenu onSnooze={onSnooze} />
        {dismissAction ? (
          <button
            onClick={() => onDismiss(dismissAction)}
            aria-label={`Stop suggesting ${item.name}`}
            title={GROCERY_DISMISS_LABELS[dismissAction].detail}
            className={DISMISS_BUTTON_CLASS}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <DismissMenu itemName={item.name} onPick={onDismiss} />
        )}
      </div>
    </div>
  );
}

const DISMISS_BUTTON_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors';

/** First click on X before a default is stored: pick Not now or Archive. The
 *  pick runs now and becomes what the X does from then on. */
function DismissMenu({ itemName, onPick }: { itemName: string; onPick: (action: GroceryDismissAction) => void }) {
  return (
    <PopMenu
      trigger={<X className="h-3.5 w-3.5" />}
      triggerClassName={DISMISS_BUTTON_CLASS}
      triggerLabel={`Stop suggesting ${itemName}`}
      align="right"
      width="w-72"
    >
      {(close) => (
        <>
          <MenuLabel>Stop suggesting {itemName}</MenuLabel>
          {GROCERY_DISMISS_ACTIONS.map((action) => (
            <MenuItem key={action} onClick={() => { onPick(action); close(); }}>
              {GROCERY_DISMISS_LABELS[action].title}
            </MenuItem>
          ))}
          <p className="px-3.5 pb-2.5 pt-1 text-xs text-muted-foreground">
            Not now hides it until you next buy it. Archive takes it off the list and keeps its details in your
            library. Your pick becomes what the X does; change it in Settings, Groceries.
          </p>
        </>
      )}
    </PopMenu>
  );
}

/** Collapsible section for the /groceries list — hidden entirely when empty. */
export function SuggestReAddSection({
  items,
  onAdd,
  onSnooze,
  dismissAction,
  onDismiss,
  onAddAll,
  bare,
}: {
  items: SuggestReAddItem[];
  onAdd: (item: SuggestReAddItem) => void;
  onSnooze: (item: SuggestReAddItem, untilISO: string) => void;
  dismissAction: GroceryDismissAction | null;
  onDismiss: (item: SuggestReAddItem, action: GroceryDismissAction) => void;
  /** HOUP-317: moves every suggestion to `needed` in one action. Only offered
   *  at 2+ suggestions — the Home hub widgets don't pass this. */
  onAddAll?: () => void;
  /** Just the rows, all of them: no frame, header or cap. The Buy again
   *  section's Review list uses this. */
  bare?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // HOUP-317: above the cap, only the top N render until expanded. Reset once
  // the list falls back to (or below) the cap so the expansion doesn't linger.
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (items.length <= GROCERY_SUGGEST_CAP) setShowAll(false);
  }, [items.length]);
  if (items.length === 0) return null;

  const rows = (list: SuggestReAddItem[]) =>
    list.map((item) => (
      <SuggestReAddRow
        key={item.id}
        item={item}
        onAdd={() => onAdd(item)}
        onSnooze={(untilISO) => onSnooze(item, untilISO)}
        dismissAction={dismissAction}
        onDismiss={(action) => onDismiss(item, action)}
      />
    ));
  if (bare) return <div className="space-y-1.5">{rows(items)}</div>;

  const truncated = items.length > GROCERY_SUGGEST_CAP && !showAll;
  const visible = truncated ? items.slice(0, GROCERY_SUGGEST_CAP) : items;

  return (
    <div className="rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
      <div className="flex items-center gap-2 p-3 pl-4">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-3 text-left min-w-0"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              collapsed ? '-rotate-90' : ''
            )}
          />
          <span className="font-semibold text-[15px] text-foreground">
            Suggest re-add <span className="text-muted-foreground font-normal tabular-nums">{items.length}</span>
          </span>
        </button>
        {onAddAll && items.length >= 2 && (
          <button
            onClick={onAddAll}
            className="flex-shrink-0 min-h-[44px] rounded-lg border border-border px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            Add all {items.length}
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="px-3 pb-3 space-y-1.5">
          {rows(visible)}
          {truncated && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full min-h-[44px] rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/10 transition-colors text-center"
            >
              <b>{items.length - GROCERY_SUGGEST_CAP} more</b> past shelf life
            </button>
          )}
        </div>
      )}
    </div>
  );
}
