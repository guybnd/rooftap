'use client';

import { useState, useRef, useEffect, type ButtonHTMLAttributes, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCloseOnBack } from '@/hooks/use-sheet-gestures';
import { BottomSheet } from '@/components/ui/bottom-sheet';

interface PopMenuProps {
  /** Content rendered inside the trigger button. */
  trigger: ReactNode;
  /** Classes for the trigger button. */
  triggerClassName?: string;
  triggerLabel?: string;
  /** Panel content. Receives a `close` callback so items can dismiss the menu. */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  /** Tailwind width class for the panel. */
  width?: string;
  /** Controlled open state (FLUX-195) — lets a caller drive the menu open from
   *  a gesture other than the trigger button (e.g. press-and-hold). Falls back
   *  to internal state when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render as a full-width bottom sheet on coarse-pointer (touch) devices,
   *  instead of the trigger-anchored floating panel (FLUX-195 decision 9). */
  mobileSheet?: boolean;
  /** FLUX-198: pinned above the menu items on the mobile sheet path, so the item
   *  you held is still legible once the sheet dims the list behind it. Sheet-only
   *  (the floating desktop dropdown already sits right next to its row). Omit for
   *  today's behavior. */
  previewContent?: ReactNode;
  /** Replaces the trigger's open-on-click, for a trigger whose tap does
   *  something else and opens the menu on hold or right-click instead (driven
   *  through `open`/`onOpenChange` plus `triggerProps`). */
  onTriggerClick?: () => void;
  /** Extra handlers/attributes for the trigger button (e.g. long-press). */
  triggerProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'type'>;
}

// Right-click (Hearth §13 "Desktop shell"): a menu a row opens from a
// contextmenu event (useRowLongPress and friends) opens at the pointer, as a
// desktop context menu does, instead of under the whole row. The last
// right-click is noted here once for every menu.
let lastContextMenu: { x: number; y: number; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'contextmenu',
    (e) => {
      lastContextMenu = { x: e.clientX, y: e.clientY, at: Date.now() };
    },
    true
  );
}
/** How recent a right-click must be to count as the one that opened a menu. */
const CONTEXT_MENU_WINDOW_MS = 600;
/** Room a pointer-anchored panel keeps from the right edge before it opens leftward. */
const CONTEXT_MENU_ROOM_PX = 280;

// Lightweight popover menu with click-outside + Escape handling. Tap-friendly:
// the menu opens on click/tap (no hover dependency), so it works on mobile.
// The panel renders in a portal with fixed positioning so it floats above any
// `overflow-hidden` / transformed ancestor (e.g. swipeable cards) instead of
// being clipped inside them.
export function PopMenu({
  trigger,
  triggerClassName,
  triggerLabel,
  children,
  align = 'right',
  width = 'w-52',
  open: controlledOpen,
  onOpenChange,
  mobileSheet,
  previewContent,
  onTriggerClick,
  triggerProps,
}: PopMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? (next as (p: boolean) => boolean)(open) : next;
    if (!isControlled) setInternalOpen(resolved);
    onOpenChange?.(resolved);
  };
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<CSSProperties>({});
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarsePointer(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const asSheet = !!mobileSheet && isCoarsePointer;

  // Android/browser Back closes the menu instead of navigating the page away.
  // Scoped to the floating-dropdown path only — the sheet path gets the same
  // behavior (plus drag-to-dismiss) from BottomSheet itself below. Registering
  // both here and inside BottomSheet for the same open menu would push two
  // history markers for one logical sheet (FLUX-201 bug #5's failure mode).
  useCloseOnBack(open && !asSheet, () => setOpen(false));

  // Position the floating panel relative to the trigger, and keep it pinned
  // while the page scrolls or resizes. Not needed for the bottom-sheet layout.
  useEffect(() => {
    if (!open || asSheet) return;
    // Opened by a right-click inside the trigger: anchor at the pointer, kept
    // as an offset into the trigger so the panel follows it on scroll.
    const first = triggerRef.current?.getBoundingClientRect();
    const click = lastContextMenu;
    const pointer =
      first && click && Date.now() - click.at < CONTEXT_MENU_WINDOW_MS &&
      click.x >= first.left && click.x <= first.right && click.y >= first.top && click.y <= first.bottom
        ? { dx: click.x - first.left, dy: click.y - first.top }
        : null;
    const reposition = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (pointer) {
        const x = r.left + pointer.dx;
        const y = r.top + pointer.dy;
        const style: CSSProperties = { position: 'fixed' };
        if (y > window.innerHeight * 0.62) style.bottom = Math.max(8, window.innerHeight - y + 2);
        else style.top = y + 2;
        if (x > window.innerWidth - CONTEXT_MENU_ROOM_PX) style.right = Math.max(8, window.innerWidth - x);
        else style.left = Math.max(8, x);
        setCoords(style);
        return;
      }
      const openUp = r.bottom > window.innerHeight * 0.62; // flip up near the fold
      const style: CSSProperties = { position: 'fixed' };
      if (openUp) style.bottom = Math.max(8, window.innerHeight - r.top + 6);
      else style.top = r.bottom + 6;
      if (align === 'right') style.right = Math.max(8, window.innerWidth - r.right);
      else style.left = Math.max(8, r.left);
      setCoords(style);
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, align, asSheet]);

  // Click-outside + Escape — floating-dropdown path only. The sheet path gets
  // both natively from base-ui's Dialog (via BottomSheet); wiring this too
  // would fire against a stale/unset menuRef (the sheet lives in BottomSheet's
  // own portal) and misfire on every tap inside the sheet.
  useEffect(() => {
    if (!open || asSheet) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asSheet]);

  return (
    <>
      <button
        {...triggerProps}
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onTriggerClick ?? (() => setOpen((v) => !v))}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {asSheet ? (
        <BottomSheet
          open={open}
          onOpenChange={setOpen}
          overlayClassName="z-[59] bg-black/50 duration-150 supports-backdrop-filter:backdrop-blur-none"
          className="z-[60] max-h-[60vh] w-full gap-0 overflow-y-auto overscroll-none rounded-t-2xl border border-white/10 bg-popover/95 py-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl shadow-2xl shadow-black/50 data-ending-style:translate-y-[2.5rem] data-starting-style:translate-y-[2.5rem]"
          handleClassName="mb-0"
          handleIndicatorClassName="bg-white/20"
          popupProps={{ role: 'menu' }}
        >
          {previewContent && (
            <div className="mx-3.5 mb-1.5 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              {previewContent}
            </div>
          )}
          {children(() => setOpen(false))}
        </BottomSheet>
      ) : (
        open && mounted && createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ ...coords, animation: 'pop-in var(--motion-base) var(--motion-ease-out)' }}
            className={cn(
              'max-h-[60vh] overflow-y-auto overscroll-none border border-white/10 bg-popover/95 backdrop-blur-xl shadow-2xl shadow-black/50 z-[60] py-1',
              `${width} rounded-xl`
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )
      )}
    </>
  );
}

interface MenuItemProps {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  trailing?: ReactNode;
  disabled?: boolean;
}

// Single row inside a PopMenu. Sized for touch (≥40px tall), with the current
// selection carried by a tinted row + trailing check (not just text colour)
// and an explicit pressed state so taps visibly land (Guy, 2026-07-12: "hard
// to see what I'm clicking on since a lot of items in the list are very
// small… add clicked-on highlight").
export function MenuItem({ onClick, icon, children, danger, active, trailing, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${
        danger
          ? 'text-destructive hover:bg-destructive/10 active:bg-destructive/20'
          : active
            ? 'bg-primary/10 text-primary hover:bg-primary/15 active:bg-primary/25'
            : 'text-foreground hover:bg-accent active:bg-white/15'
      }`}
    >
      {icon && <span className="flex-shrink-0 text-muted-foreground">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {trailing ?? (active ? <Check className="h-4 w-4 flex-shrink-0 text-primary" /> : null)}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      {children}
    </div>
  );
}

export function MenuDivider() {
  return <div className="my-1 border-t border-border/70" />;
}
