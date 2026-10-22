"use client";

// Hearth §13.7 "Row menu" (Guy, 2026-10-22): the one right-click menu every
// line item opens with a mouse. A row hands useRowContextMenu its RowMenu (core
// row-actions.ts) and spreads the returned handler; this draws it at the
// pointer in the shared order (open, main verb, quick settings, share, edit,
// delete), with the item's name on top. A setting with choices opens a
// submenu to the side. It works from the keyboard: arrows move, Right or
// Enter opens a submenu, Left or Escape steps back, a letter jumps to the
// next item that starts with it. Touch keeps each row's own long-press sheet.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock,
  Archive,
  ArrowUpRight,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  EyeOff,
  Files,
  Flag,
  FolderInput,
  ListChecks,
  ListTodo,
  MessageSquare,
  Navigation,
  Pencil,
  Repeat,
  RotateCcw,
  Share2,
  SquareMousePointer,
  Star,
  StickyNote,
  Trash2,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { arrangeRowActions, type RowAction, type RowActionIcon, type RowMenu } from "@homeup/core";
import { cn } from "@/lib/utils";

const ICONS: Record<RowActionIcon, LucideIcon> = {
  open: ArrowUpRight,
  done: CheckCircle2,
  undo: RotateCcw,
  due: CalendarClock,
  snooze: AlarmClock,
  repeat: Repeat,
  assign: UserRound,
  priority: Flag,
  move: FolderInput,
  status: ListChecks,
  checklist: ListTodo,
  comment: MessageSquare,
  note: StickyNote,
  star: Star,
  share: Share2,
  copy: Copy,
  duplicate: Files,
  calendar: CalendarPlus,
  cost: Wallet,
  directions: Navigation,
  hide: EyeOff,
  select: SquareMousePointer,
  edit: Pencil,
  archive: Archive,
  delete: Trash2,
};

/** Room kept from the window's edges (px). */
const EDGE = 8;

interface OpenState {
  x: number;
  y: number;
  menu: RowMenu;
}

function finePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}

/**
 * Right-click for a row. `getMenu` runs when the menu opens, so it always
 * reads the row's current state; return null to leave the browser's own menu.
 * Spread `onContextMenu` on the row and render `menu` anywhere inside it.
 */
export function useRowContextMenu(getMenu: () => RowMenu | null) {
  const [open, setOpen] = useState<OpenState | null>(null);
  const getRef = useRef(getMenu);
  getRef.current = getMenu;

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    if (!finePointer()) return false;
    const target = e.target as HTMLElement;
    // Text fields keep the browser's menu (paste, spelling).
    if (target.closest("input, textarea, [contenteditable='true']")) return false;
    const menu = getRef.current();
    if (!menu || arrangeRowActions(menu.actions).length === 0) return false;
    e.preventDefault();
    e.stopPropagation();
    setOpen({ x: e.clientX, y: e.clientY, menu });
    return true;
  }, []);

  // The same menu from a button or a double-click, at a given point.
  const openAt = useCallback((x: number, y: number) => {
    const menu = getRef.current();
    if (!menu || arrangeRowActions(menu.actions).length === 0) return false;
    setOpen({ x, y, menu });
    return true;
  }, []);

  const close = useCallback(() => setOpen(null), []);
  const menu = open ? <RowContextMenu key={`${open.x},${open.y}`} at={open} onClose={close} /> : null;
  return { onContextMenu, openAt, menu, isOpen: !!open };
}

type Flat = { action: RowAction; group: number };

function RowContextMenu({ at, onClose }: { at: OpenState; onClose: () => void }) {
  const groups = arrangeRowActions(at.menu.actions);
  const flat: Flat[] = groups.flatMap((g, gi) => g.map((action) => ({ action, group: gi })));
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [style, setStyle] = useState<CSSProperties>({ left: at.x, top: at.y, visibility: "hidden" });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; viaKeyboard: boolean } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  // Place at the pointer, flipped or nudged to stay on screen.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = at.x + width + EDGE > vw ? Math.max(EDGE, at.x - width) : at.x;
    const top = at.y + height + EDGE > vh ? Math.max(EDGE, vh - height - EDGE) : at.y;
    setStyle({ left, top });
    el.focus({ preventScroll: true });
  }, [at.x, at.y]);

  // Anything outside closes it: a click, a scroll, the window losing focus.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-row-menu]")) onClose();
    };
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !panelRef.current?.parentElement?.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("contextmenu", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => () => void (hoverTimer.current && window.clearTimeout(hoverTimer.current)), []);

  const run = (fn: () => void) => {
    onClose();
    // Let the menu leave before the action opens a dialog or moves focus.
    requestAnimationFrame(fn);
  };

  const activate = (i: number, viaKeyboard: boolean) => {
    const { action } = flat[i];
    if (action.disabled) return;
    if (action.options) setSub({ index: i, viaKeyboard });
    else if (action.run) run(action.run);
  };

  const move = (from: number, step: 1 | -1) => {
    for (let n = 1; n <= flat.length; n++) {
      const i = (from + step * n + flat.length * 2) % flat.length;
      if (!flat[i].action.disabled) return i;
    }
    return from;
  };

  const focusItem = (i: number) => {
    setActive(i);
    itemRefs.current[i]?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (sub) return; // the submenu has the keys
    if (e.key === "ArrowDown") focusItem(move(active, 1));
    else if (e.key === "ArrowUp") focusItem(move(active < 0 ? 0 : active, -1));
    else if (e.key === "Home") focusItem(move(-1, 1));
    else if (e.key === "End") focusItem(move(0, -1));
    else if ((e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") && active >= 0) activate(active, true);
    else if (e.key === "Escape" || e.key === "Tab") onClose();
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      for (let n = 1; n <= flat.length; n++) {
        const i = (active + n) % flat.length;
        if (!flat[i].action.disabled && flat[i].action.label.toLowerCase().startsWith(ch)) return void focusItem(i);
      }
      return;
    } else return;
    e.preventDefault();
  };

  const openSubOnHover = (i: number) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    const has = !!flat[i].action.options;
    // A short pause, so a pointer crossing the list on its way to an open
    // submenu doesn't swap it out from under it.
    hoverTimer.current = window.setTimeout(() => setSub(has ? { index: i, viaKeyboard: false } : null), has ? 90 : 160);
  };

  return createPortal(
    <div data-row-menu className="fixed inset-0 z-[70]" style={{ pointerEvents: "none" }}>
      <div
        ref={panelRef}
        role="menu"
        aria-label={at.menu.title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ ...style, pointerEvents: "auto" }}
        className="row-menu fixed w-64 overflow-hidden rounded-2xl border border-border/70 bg-popover/95 py-1.5 text-popover-foreground shadow-2xl shadow-black/40 backdrop-blur-xl focus:outline-none"
      >
        <div className="px-3.5 pb-1.5 pt-1">
          <p className="truncate text-[13px] font-semibold">{at.menu.title}</p>
          {at.menu.kind && <p className="text-[11px] text-muted-foreground">{at.menu.kind}</p>}
        </div>
        {flat.map(({ action, group }, i) => {
          const Icon = action.icon ? ICONS[action.icon] : null;
          const danger = !!action.danger;
          const subOpen = sub?.index === i;
          return (
            <div key={action.id}>
              {(i === 0 || flat[i - 1].group !== group) && <div role="separator" className="mx-2.5 my-1 h-px bg-border/70" />}
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                aria-haspopup={action.options ? "menu" : undefined}
                aria-expanded={action.options ? subOpen : undefined}
                aria-disabled={action.disabled || undefined}
                tabIndex={-1}
                onMouseEnter={() => {
                  setActive(i);
                  openSubOnHover(i);
                }}
                onFocus={() => setActive(i)}
                onClick={() => activate(i, false)}
                className={cn(
                  "mx-1.5 flex h-9 w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium outline-none transition-colors",
                  action.disabled && "opacity-45",
                  danger ? "text-destructive" : "text-foreground",
                  (active === i || subOpen) && (danger ? "bg-destructive/12" : "bg-accent")
                )}
              >
                <span className={cn("flex size-4 shrink-0 items-center justify-center", danger ? "text-destructive" : "text-muted-foreground")}>
                  {Icon && <Icon className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {action.value && <span className="max-w-[7.5rem] truncate text-xs text-muted-foreground">{action.value}</span>}
                {action.shortcut && <kbd className="font-mono text-[10.5px] text-muted-foreground">{action.shortcut}</kbd>}
                {action.options && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            </div>
          );
        })}
      </div>
      {/* Beside the panel, not in it: the panel's blur would make it the
          submenu's containing block and clip it. */}
      {sub && flat[sub.index]?.action.options && (
        <SubMenu
          anchor={itemRefs.current[sub.index]}
          action={flat[sub.index].action}
          focusFirst={sub.viaKeyboard}
          onBack={() => {
            const i = sub.index;
            setSub(null);
            focusItem(i);
          }}
          onPick={run}
          onClose={onClose}
        />
      )}
    </div>,
    document.body
  );
}

function SubMenu({
  anchor,
  action,
  focusFirst,
  onBack,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  action: RowAction;
  focusFirst: boolean;
  onBack: () => void;
  onPick: (fn: () => void) => void;
  onClose: () => void;
}) {
  const options = action.options ?? [];
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const [active, setActive] = useState(focusFirst ? Math.max(0, options.findIndex((o) => o.checked)) : -1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const right = a.right + 4;
    const left = right + width + EDGE > window.innerWidth ? Math.max(EDGE, a.left - width - 4) : right;
    const top = Math.min(a.top - 6, window.innerHeight - height - EDGE);
    setStyle({ left, top: Math.max(EDGE, top) });
    if (focusFirst) itemRefs.current[Math.max(0, options.findIndex((o) => o.checked))]?.focus({ preventScroll: true });
    // Placed once per opening; the options don't move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, focusFirst]);

  const focusAt = (i: number) => {
    const n = (i + options.length) % options.length;
    setActive(n);
    itemRefs.current[n]?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") focusAt(active + 1);
    else if (e.key === "ArrowUp") focusAt(active < 0 ? options.length - 1 : active - 1);
    else if (e.key === "ArrowLeft" || e.key === "Escape") onBack();
    else if ((e.key === "Enter" || e.key === " " || e.key === "ArrowRight") && active >= 0) onPick(options[active].run);
    else if (e.key === "Tab") onClose();
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={action.label}
      onKeyDown={onKeyDown}
      style={{ ...style, pointerEvents: "auto" }}
      className="row-menu fixed max-h-[min(60vh,420px)] w-56 overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-popover/95 py-1.5 text-popover-foreground shadow-2xl shadow-black/40 backdrop-blur-xl"
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="menuitemradio"
          aria-checked={!!o.checked}
          tabIndex={-1}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(o.run)}
          className={cn(
            "mx-1.5 flex h-9 w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium outline-none transition-colors",
            active === i && "bg-accent"
          )}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {o.swatch ? (
              o.swatch.startsWith("bg-") ? (
                <span className={cn("size-2.5 rounded-full", o.swatch)} />
              ) : (
                <span className="size-2.5 rounded-full" style={{ background: o.swatch }} />
              )
            ) : null}
          </span>
          <span className="min-w-0 flex-1 truncate">{o.label}</span>
          {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
          {o.checked && <Check className="size-4 shrink-0 text-primary" />}
        </button>
      ))}
    </div>
  );
}

/** A row's handlers with right-click taken over by the shared menu on a mouse, and left to `fallback` on touch. */
export function withRowMenu<H extends { onContextMenu?: (e: ReactMouseEvent) => void }>(
  handlers: H,
  rowMenu: { onContextMenu: (e: ReactMouseEvent) => boolean }
): H {
  return {
    ...handlers,
    onContextMenu: (e: ReactMouseEvent) => {
      if (!rowMenu.onContextMenu(e)) handlers.onContextMenu?.(e);
    },
  };
}

export type { ReactNode };
