'use client';

// A Costs row's menu. With a mouse, right-click draws the row's RowMenu (core
// costRowMenu) at the pointer, like every other row (Hearth §13.7). On touch,
// a hold opens this sheet with the same actions: the header states the row
// (E1), "Move to" opens in place as the category grid, and Archive or Hide
// sits alone at the end (E4). CostRowShell gives a row its swipes (right:
// move, left: hide or archive), its hold and its right-click.
// Phone twin: apps/mobile/src/features/costs/cost-row-sheet.tsx.

import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Archive, ArrowRight, ArrowUpRight, EyeOff, MessageSquare, Pencil, type LucideIcon } from 'lucide-react';
import { arrangeRowActions, type CostCategory, type RowAction, type RowActionIcon, type RowMenu } from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { SwipeActions } from '@/components/ui/swipe-actions';
import { useLongPress } from '@/hooks/use-long-press';
import { tick } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { CategoryGlyph } from './category-glyph';
import { CategoryGrid, SHEET } from './category-picker';

const ICONS: Partial<Record<RowActionIcon, LucideIcon>> = {
  open: ArrowUpRight,
  comment: MessageSquare,
  edit: Pencil,
  archive: Archive,
  hide: EyeOff,
};

export interface CostRowSheetState {
  menu: RowMenu;
  category: CostCategory | null;
  amount?: string;
  meta?: string;
}

export function CostRowSheet({ state, choices, onClose }: { state: CostRowSheetState | null; choices: readonly CostCategory[]; onClose: () => void }) {
  const groups = state ? arrangeRowActions(state.menu.actions) : [];
  const run = (a: RowAction) => {
    onClose();
    setTimeout(() => a.run?.(), 0);
  };
  return (
    <BottomSheet open={!!state} onOpenChange={(o) => { if (!o) onClose(); }} overlayClassName="bg-black/40" className={SHEET} handleClassName="sm:hidden" popupProps={{ 'aria-label': state?.menu.title ?? 'Cost menu' }}>
      {state ? (
        <div className="pb-2 pt-1">
          <div className="flex items-center gap-2.5 border-b border-border pb-3">
            {state.category ? <CategoryGlyph category={state.category} /> : <span className="size-7 shrink-0 rounded-[9px] border border-dashed border-muted-foreground/60" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{state.menu.title}</p>
              {state.meta || state.menu.kind ? <p className="truncate text-xs tabular-nums text-muted-foreground">{state.meta ?? state.menu.kind}</p> : null}
            </div>
            {state.amount ? <p className="text-sm font-semibold tabular-nums text-foreground">{state.amount}</p> : null}
          </div>
          {groups.map((group, gi) => (
            <div key={group[0].group} className={cn('pt-1', gi > 0 && 'mt-1 border-t border-border')}>
              {group.map((a) =>
                a.options ? (
                  <div key={a.id} className="space-y-2 px-1 pb-2 pt-2">
                    <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{a.label}</p>
                    <CategoryGrid
                      choices={choices}
                      current={(a.options.find((o) => o.checked)?.id as CostCategory | undefined) ?? null}
                      onPick={(c) => {
                        const option = a.options!.find((o) => o.id === c);
                        if (!option || option.checked) return;
                        tick();
                        onClose();
                        option.run();
                      }}
                    />
                  </div>
                ) : (
                  <MenuItem key={a.id} action={a} onClick={() => run(a)} />
                ),
              )}
            </div>
          ))}
        </div>
      ) : null}
    </BottomSheet>
  );
}

function MenuItem({ action, onClick }: { action: RowAction; onClick: () => void }) {
  const Icon = action.icon ? ICONS[action.icon] : undefined;
  const danger = action.danger || action.group === 'danger';
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-muted/50">
      {Icon ? <Icon className={cn('h-3.5 w-3.5', danger ? 'text-destructive' : 'text-muted-foreground')} /> : null}
      <span className={cn('flex-1 text-base', danger ? 'font-medium text-destructive' : 'text-foreground')}>{action.label}</span>
      {action.value ? <span className="text-sm text-muted-foreground">{action.value}</span> : null}
    </button>
  );
}

const SWIPE = { bg: 'bg-muted', activeBg: 'bg-muted-foreground/30' };

/**
 * A Costs row's gestures. Click opens it; a hold on touch (or a long-press
 * contextmenu) opens `onSheet`; right-click with a mouse draws `menu()` at
 * the pointer. Swipe right moves, swipe left hides or archives.
 */
export function CostRowShell({
  children,
  label,
  className,
  onOpen,
  menu,
  onSheet,
  onMove,
  away,
  onAway,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  onOpen: () => void;
  menu: () => RowMenu | null;
  onSheet: () => void;
  onMove?: () => void;
  away?: { label: string; kind: 'hide' | 'archive' } | null;
  onAway?: () => void;
}) {
  const rowMenu = useRowContextMenu(menu);
  const hold = useLongPress(onSheet);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    hold.handlers.onPointerDown(e);
  };
  const onContextMenu = (e: MouseEvent) => {
    if (rowMenu.onContextMenu(e)) return;
    e.preventDefault();
    onSheet();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (!rowMenu.openAt(r.left + 24, r.bottom)) onSheet();
    }
  };
  const AwayIcon = away?.kind === 'archive' ? Archive : EyeOff;
  return (
    <SwipeActions
      onSwipeRight={onMove}
      right={onMove ? { ...SWIPE, icon: <ArrowRight className="h-4 w-4 text-foreground" />, label: 'Move' } : undefined}
      onSwipeLeft={away ? onAway : undefined}
      left={away ? { ...SWIPE, icon: <AwayIcon className="h-4 w-4 text-foreground" />, label: away.label } : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={() => {
          if (hold.consumeClick()) return;
          onOpen();
        }}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        className={cn('cursor-pointer bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        {children}
      </div>
      {rowMenu.menu}
    </SwipeActions>
  );
}
