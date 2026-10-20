'use client';

// "Re-add suggestions": items that are probably running low (have-it past
// shelf life) as compact chips carrying the essential star and how many days
// overdue. Only a handful show; "+N more" reveals the rest. Tapping a chip
// adds it back (the caller shows the Undo pill). Holding (with the shared
// hold fill and haptic) or right-clicking a chip opens Snooze / Stop
// suggesting; Full review (next to Show more) expands the full rows (emoji, days, Add / Snooze / X).
// Mirrors apps/mobile/src/features/groceries/re-add-suggestions.tsx.

import { useEffect, useState } from 'react';
import { Plus, Star } from 'lucide-react';
import {
  RE_ADD_CHIP_CAP,
  GROCERY_DISMISS_ACTIONS,
  GROCERY_DISMISS_LABELS,
  snoozeUntilISO,
  type GroceryDismissAction,
  type SuggestReAddItem,
} from '@homeup/core';
import { PopMenu, MenuDivider, MenuItem, MenuLabel } from '../setup/pop-menu';
import { HOLD_FILL_DELAY_MS, useLongPress } from '@/hooks/use-long-press';
import { HoldFillOverlay } from '@/components/ui/hold-fill-overlay';
import { SuggestReAddSection } from './suggest-re-add-section';

const CHIP_CLASS =
  'relative inline-flex min-h-[36px] items-center gap-1 overflow-hidden rounded-full border border-border bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors';

const FOOTER_BUTTON_CLASS =
  'min-h-[36px] rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors';

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
}

export function ReAddSuggestions({ runningLow, onAdd, onAddAll, onSnooze, dismissAction, onDismiss, cap = RE_ADD_CHIP_CAP }: ReAddSuggestionsProps) {
  const [reviewing, setReviewing] = useState(false);
  const [showAllLow, setShowAllLow] = useState(false);
  useEffect(() => {
    if (runningLow.length === 0) setReviewing(false);
    if (runningLow.length <= cap) setShowAllLow(false);
  }, [runningLow.length, cap]);

  if (runningLow.length === 0) return null;

  const hiddenLow = showAllLow ? 0 : Math.max(0, runningLow.length - cap);
  const visibleLow = hiddenLow > 0 ? runningLow.slice(0, cap) : runningLow;

  return (
    <div className="space-y-2">
      <div className="flex min-h-[36px] items-center gap-2 px-1">
        <p className="flex-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Re-add suggestions <span className="tabular-nums">{runningLow.length}</span>
        </p>
        {runningLow.length >= 2 && (
          <button
            onClick={() => {
              // A bulk add gets a confirm on top of the Undo pill (Guy, 2026-10-18).
              if (confirm(`Add all ${runningLow.length} suggestions to the list?`)) onAddAll();
            }}
            className="min-h-[36px] rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            Add all {runningLow.length}
          </button>
        )}
      </div>

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
        <div className="flex flex-wrap gap-2">
          {visibleLow.map((item) => (
            <RunningLowChip
              key={item.id}
              item={item}
              onAdd={() => onAdd(item)}
              onSnooze={(untilISO) => onSnooze(item, untilISO)}
              dismissAction={dismissAction}
              onDismiss={(action) => onDismiss(item, action)}
            />
          ))}
        </div>
      )}

      {/* Footer: more chips, or the full rows with every control. */}
      <div className="flex flex-wrap gap-2 px-1">
        {!reviewing && runningLow.length > cap && (
          <button onClick={() => setShowAllLow((v) => !v)} className={FOOTER_BUTTON_CLASS}>
            {hiddenLow > 0 ? `Show ${hiddenLow} more` : 'Show fewer'}
          </button>
        )}
        <button onClick={() => setReviewing((v) => !v)} aria-expanded={reviewing} className={FOOTER_BUTTON_CLASS}>
          {reviewing ? 'Compact view' : 'Full review'}
        </button>
      </div>
    </div>
  );
}

/** Tap adds; hold (touch, with the hold fill) or right-click opens Snooze / Stop suggesting. */
function RunningLowChip({
  item,
  onAdd,
  onSnooze,
  dismissAction,
  onDismiss,
}: {
  item: SuggestReAddItem;
  onAdd: () => void;
  onSnooze: (untilISO: string) => void;
  dismissAction: GroceryDismissAction | null;
  onDismiss: (action: GroceryDismissAction) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { handlers, consumeClick, progress } = useLongPress(() => setMenuOpen(true), true, {
    trackProgress: true,
    fillDelayMs: HOLD_FILL_DELAY_MS,
  });
  const dismissChoices = dismissAction ? [dismissAction] : GROCERY_DISMISS_ACTIONS;

  return (
    <PopMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      mobileSheet
      align="left"
      width="w-60"
      triggerLabel={`Need ${item.name} again, ${item.daysOverdue} days past shelf life. Hold for more.`}
      triggerClassName={CHIP_CLASS}
      onTriggerClick={() => {
        if (consumeClick()) return;
        onAdd();
      }}
      triggerProps={{
        onPointerDown: (e) => {
          if (e.pointerType !== 'mouse') handlers.onPointerDown(e);
        },
        onMouseDown: (e) => e.preventDefault(),
        onContextMenu: (e) => {
          e.preventDefault();
          setMenuOpen(true);
        },
      }}
      trigger={
        <>
          <HoldFillOverlay progress={progress} />
          <span className="relative z-10 inline-flex items-center gap-1">
            {item.is_essential ? (
              <Star className="h-3 w-3 fill-warning text-warning" />
            ) : (
              <Plus className="h-3 w-3 text-primary" />
            )}
            {item.name}
            <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">{item.daysOverdue}d</span>
          </span>
        </>
      }
    >
      {(close) => (
        <>
          <MenuLabel>{item.name}, {item.daysOverdue}d past shelf life</MenuLabel>
          <MenuItem onClick={() => { onSnooze(snoozeUntilISO('1d')); close(); }}>Snooze until tomorrow</MenuItem>
          <MenuItem onClick={() => { onSnooze(snoozeUntilISO('1w')); close(); }}>Snooze a week</MenuItem>
          <MenuItem onClick={() => { onSnooze(snoozeUntilISO('1m')); close(); }}>Snooze a month</MenuItem>
          <MenuDivider />
          {dismissChoices.map((action) => (
            <MenuItem key={action} onClick={() => { onDismiss(action); close(); }}>
              {dismissAction ? 'Stop suggesting' : GROCERY_DISMISS_LABELS[action].title}
            </MenuItem>
          ))}
        </>
      )}
    </PopMenu>
  );
}
