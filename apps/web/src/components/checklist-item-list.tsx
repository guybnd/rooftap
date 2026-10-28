'use client';

// HOUP-332: the ONE web item-list primitive — resting item rows (checkbox,
// click-to-rename/re-price, delete), the fast add well (HOUP-329: multi-line
// paste, duplicate nudge, keep-focus-after-add), and the Completed band fold
// (HOUP-327). Used by BOTH the checklist detail page (`variant="detail"`) and
// the /tasks + home-hero inline panel (`variant="inline"`) so resting item-row
// markup exists in exactly one place.
//
// Deliberately NOT here (stays screen-owned, detail-only): the sort-mode menu,
// bulk actions (Check/Uncheck all, Clear completed), list settings,
// delete-list. `variant` otherwise only changes density and whether the
// trailing `done / total` + "Open full checklist" line renders (inline only —
// detail already shows that in its own header card above this list).
//
// Manual-sort move arrows (web only — mobile's reorder is a separate
// detail-only mode) stay an opt-in `onMove` prop: the detail screen passes it,
// the inline panel omits it, so reordering stays a detail-only affordance on
// both platforms without needing a second mode here.

import { useMemo, useRef, useState, type ClipboardEvent } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, ChevronRight, ChevronUp, Plus, Trash2 } from 'lucide-react';
import {
  completion,
  findDuplicateLabel,
  splitPastedIntoField,
  centsToDollars,
  dollarsToCents,
  sortItems,
  partitionDone,
  type Checklist,
  type ChecklistSortMode,
  type ChecklistTaskItem,
  formatPastDay,
  currencySymbol,
} from '@homeup/core';
import { EditableText } from '@/components/ui/editable-text';
import { memberLabel } from '@/app/setup/member-label';
import { cn } from '@/lib/utils';

export interface ChecklistItemListViewPrefs {
  sortMode: ChecklistSortMode;
  completedToBottom: boolean;
  collapsed: boolean;
  setCollapsed: (on: boolean) => void;
}

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export interface ChecklistItemListProps {
  checklist: Checklist;
  /** The flat, order-ascending, unpartitioned array (D7) — never a sorted view. */
  orderedItems: ChecklistTaskItem[];
  viewPrefs: ChecklistItemListViewPrefs;
  variant: 'detail' | 'inline';
  /** When given, the "checked by" caption names the member; omit for date-only (no member context available). */
  memberProfiles?: MemberProfiles;
  onToggle: (item: ChecklistTaskItem) => void;
  onAdd: (labels: string[], opts?: { costCents?: number | null }) => ChecklistTaskItem[];
  onRename: (item: ChecklistTaskItem, label: string) => void;
  onReprice: (item: ChecklistTaskItem, dollars: string) => void;
  onDelete: (item: ChecklistTaskItem) => void;
  /** Manual-sort reorder arrows — detail screen only; omit to hide them. */
  onMove?: (item: ChecklistTaskItem, dir: -1 | 1) => void;
  /** Open the full checklist detail page — inline variant only. */
  openFullHref?: string;
  /** Focus the add well's label input once, on mount (quick-menu create flow). */
  autoFocusAdd?: boolean;
}

export function ChecklistItemList({
  checklist,
  orderedItems,
  viewPrefs,
  variant,
  onToggle,
  onAdd,
  onRename,
  onReprice,
  onDelete,
  onMove,
  openFullHref,
  autoFocusAdd,
  memberProfiles,
}: ChecklistItemListProps) {
  const sortedItems = useMemo(() => sortItems(orderedItems, viewPrefs.sortMode), [orderedItems, viewPrefs.sortMode]);
  const { open: openItems, done: doneItems } = useMemo(() => partitionDone(sortedItems), [sortedItems]);
  const { done, total } = useMemo(() => completion(orderedItems), [orderedItems]);

  const [newLabel, setNewLabel] = useState('');
  const [newCost, setNewCost] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);
  const duplicate = useMemo(() => findDuplicateLabel(orderedItems, newLabel), [orderedItems, newLabel]);

  const commitLabels = (labels: string[]) => {
    const costCents = checklist.type === 'shopping' && newCost.trim() ? Math.round(parseFloat(newCost) * 100) : null;
    const rows = onAdd(labels, { costCents: Number.isFinite(costCents as number) ? costCents : null });
    if (rows.length === 0) return;
    setNewLabel('');
    if (rows.length === 1) setNewCost('');
    labelInputRef.current?.focus();
  };

  const addItem = (opts?: { force?: boolean }) => {
    if (!newLabel.trim()) return;
    if (duplicate && !opts?.force) return;
    commitLabels([newLabel]);
  };

  const onLabelPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    const el = e.currentTarget;
    const labels = splitPastedIntoField({
      current: newLabel,
      pasted: text,
      selectionStart: el.selectionStart ?? newLabel.length,
      selectionEnd: el.selectionEnd ?? el.selectionStart ?? newLabel.length,
    });
    e.preventDefault();
    if (labels.length === 0) return;
    commitLabels(labels);
  };

  // H4: rows are flush with hairline dividers (via the parent's `divide-y`,
  // see `rowListClass` below). `detail` groups them in one soft card;
  // `inline` leaves them borderless inside the task row's own card.
  const renderRow = (item: ChecklistTaskItem) => {
    const orderedIdx = orderedItems.findIndex((i) => i.id === item.id);
    return (
      <div
        key={item.id}
        className={cn(
          'flex min-h-[44px] items-start gap-3 px-3 py-2.5',
          variant === 'detail' && 'px-4',
          item.is_done && 'opacity-[0.55]',
        )}
      >
        <button
          type="button"
          onClick={() => onToggle(item)}
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
            item.is_done ? 'border-success bg-success text-success-foreground' : 'border-border hover:border-muted-foreground',
          )}
          aria-label={item.is_done ? 'Uncheck' : 'Check'}
        >
          {item.is_done && <Check className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <EditableText
              value={item.label}
              onCommit={(v) => onRename(item, v)}
              hasChanged={(next, prev) => next.trim() !== prev}
              triggerClassName={cn(
                // Items wrap: a long item reads in full, also in a narrow week board column.
                'min-w-0 text-sm [overflow-wrap:anywhere] transition-colors',
                item.is_done ? 'text-muted-foreground line-through' : 'text-foreground hover:text-primary',
              )}
              inputClassName="min-w-0 flex-1 rounded border border-input bg-muted px-1.5 py-0.5 text-sm text-foreground"
              triggerTitle="Click to rename"
            />
            {checklist.type === 'shopping' && (
              <EditableText
                value={centsToDollars(item.cost_cents)}
                onCommit={(v) => onReprice(item, v)}
                hasChanged={(next, prev) => dollarsToCents(next) !== dollarsToCents(prev)}
                type="text"
                inputMode="decimal"
                placeholder={currencySymbol()}
                triggerClassName="shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors"
                inputClassName="w-16 rounded border border-input bg-muted px-1.5 py-0.5 text-xs text-foreground"
                triggerTitle="Click to edit price"
              >
                {(item.cost_cents ?? 0) > 0 ? `${currencySymbol()}${centsToDollars(item.cost_cents)}` : '+ price'}
              </EditableText>
            )}
          </div>
          {item.is_done && item.checked_at && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {memberProfiles && `${memberLabel(item.checked_by, memberProfiles)} · `}
              {formatPastDay(new Date(item.checked_at))}
            </div>
          )}
        </div>
        <div className="-my-1.5 flex shrink-0 items-center">
          {onMove && viewPrefs.sortMode === 'manual' && (
            <>
              <button
                type="button"
                onClick={() => onMove(item, -1)}
                disabled={orderedIdx === 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 hover:bg-muted hover:text-foreground disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onMove(item, 1)}
                disabled={orderedIdx === orderedItems.length - 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 hover:bg-muted hover:text-foreground disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 hover:bg-muted hover:text-destructive"
            aria-label="Delete item"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  // H4: `detail` rows share one soft card (the ListGroup look); `inline`
  // rows sit flush in one hairline-divided block (no card-in-card).
  const rowListClass =
    variant === 'inline'
      ? 'divide-y divide-border'
      : 'divide-y divide-border overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]';

  // Add item — HOUP-329 fast entry. H4: `inline` gets the token-driven inset
  // fill (no border), matching packages/ui's native add well. It sits right
  // after the open items, above the Completed band, so new items land where
  // you typed however long the done list grows.
  const addWell = (
    <div className="space-y-1.5">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-2',
          variant === 'detail' ? 'border border-border bg-card' : 'bg-muted/30',
        )}
      >
        <input
          ref={labelInputRef}
          autoFocus={autoFocusAdd}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onPaste={onLabelPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Add an item…"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
        />
        {checklist.type === 'shopping' && (
          <input
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder={currencySymbol()}
            inputMode="decimal"
            className="w-16 rounded border border-border bg-input px-2 py-1 text-sm text-foreground placeholder-muted-foreground focus:outline-none"
          />
        )}
        <button
          type="button"
          onClick={() => addItem()}
          disabled={!newLabel.trim() || !!duplicate}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
      {duplicate && (
        <p role="status" className="px-3 text-xs font-medium text-warning">
          {duplicate.label} is already on this list ·{' '}
          <button
            type="button"
            onClick={() => addItem({ force: true })}
            className="text-ring hover:underline focus:outline-none focus-visible:underline"
          >
            Add anyway
          </button>
        </p>
      )}
    </div>
  );
  const bandDone = viewPrefs.completedToBottom && doneItems.length > 0;

  return (
    <div className={cn('space-y-2', variant === 'inline' && 'space-y-1.5')}>
      {orderedItems.length > 0 && (
        <div className="space-y-2">
          {viewPrefs.completedToBottom ? (
            <>
              {openItems.length > 0 && <div className={rowListClass}>{openItems.map(renderRow)}</div>}
              {bandDone && addWell}
              {bandDone && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => viewPrefs.setCollapsed(!viewPrefs.collapsed)}
                    aria-expanded={!viewPrefs.collapsed}
                    className="flex items-center gap-1.5 px-1 py-1 text-muted-foreground hover:text-foreground"
                  >
                    {viewPrefs.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em]">Completed</span>
                    <span className="text-[11px] tabular-nums">{doneItems.length}</span>
                  </button>
                  {!viewPrefs.collapsed && <div className={rowListClass}>{doneItems.map(renderRow)}</div>}
                </div>
              )}
            </>
          ) : (
            <div className={rowListClass}>{sortedItems.map(renderRow)}</div>
          )}
        </div>
      )}

      {!bandDone && addWell}

      {variant === 'inline' && (
        <div className="flex items-center justify-between pt-1">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {done} / {total} done
          </span>
          {openFullHref && (
            <Link href={openFullHref} className="text-xs font-medium text-primary hover:text-primary/80">
              Open full checklist ›
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
