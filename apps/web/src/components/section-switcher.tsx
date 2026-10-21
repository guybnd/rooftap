"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { Check, Settings, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import * as haptics from "@/lib/haptics";
import {
  REARRANGE_HOLD_MS,
  SPACE_GRID_CELL_HEIGHT,
  SPACE_GRID_COLUMNS,
  initRecentSections,
  moveItem,
  pickRecentSections,
  recordRecentSection,
  sectionHue,
  spaceGridCellOrigin,
  spaceGridRows,
  spaceGridSlotAt,
  splitTabBar,
  useRecentSectionIds,
  type Section,
} from "@homeup/core";
import { sectionIcons } from "@/lib/section-icons";
import { LeadingTile } from "@/components/ui/leading-tile";
import { MobileCaptureFab } from "@/components/capture/capture-buttons";
import { MeridianAxis } from "@/components/ui/meridian-axis";
import { TabGlide, type TabGlideTarget } from "@/components/ui/tab-glide";
import { suppressNextSheetTidy } from "@/hooks/use-sheet-gestures";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface SwitcherProps {
  currentSectionId: string;
  onSelect: (sectionId: string) => void;
}

interface GridProps extends SwitcherProps {
  /** Sections to render — the sidebar passes its visible (non-hidden) set. */
  sections: Section[];
}

/**
 * Desktop: always-visible 2x2 tile grid at the top of the sidebar.
 * Every section is one click away; the active tile is highlighted.
 *
 * Hearth v2 (H2, navigation): every section's glyph wears its own identity
 * hue (core section-hues.ts, resolved through `data-hue`), and the active
 * tile fills with that section's tile hue with its label in the glyph hue,
 * the same language as the phone tab bar below and the native tab bar.
 */
export function SectionSwitcherGrid({ sections, currentSectionId, onSelect }: GridProps) {
  return (
    <div className="grid grid-cols-2 gap-1.5 px-2.5 py-2.5">
      {sections.map((section) => {
        const active = section.id === currentSectionId;
        const Icon = sectionIcons[section.iconId];
        return (
          <button
            key={section.id}
            data-hue={sectionHue(section.id)}
            onClick={() => onSelect(section.id)}
            disabled={!section.enabled}
            title={section.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 text-[11px] font-medium transition-colors",
              active
                ? "bg-[var(--hue-tile)] font-semibold text-[var(--hue-glyph)]"
                : !section.enabled
                  ? "text-sidebar-foreground/30 cursor-not-allowed"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 active:scale-[0.98]"
            )}
          >
            <Icon className={cn("h-[18px] w-[18px] shrink-0", section.enabled && "text-[var(--hue-glyph)]")} />
            <span className="truncate max-w-full leading-none">{section.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

interface TabBarProps extends SwitcherProps {
  enabledSections: Section[];
  /** Every section the household has on, hidden ones too, in the saved order:
      what a held tab can be swapped for. */
  allSections: Section[];
  hiddenSectionIds: string[];
  onChooseForSlot: (slotId: string, chosenId: string) => void;
  /** Saves the More sheet's rearranged grid: every visible id, in order. */
  onReorder: (visibleIds: string[]) => void;
  overdueCount: number;
}

const MICRO_LABEL = "px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";

// Hold this long on a tab to choose what sits in its slot (native twin:
// apps/mobile's primary-tab-bar.tsx).
const SLOT_PICK_HOLD_MS = 450;
// A finger that drifts further than this is scrolling or sliding, not holding.
const HOLD_SLOP_PX = 10;

/**
 * Hold a tab to pick what sits in its slot. Touch browsers don't share one
 * long-press event (iOS Safari fires no contextmenu), so this times the
 * pointer itself; contextmenu (Android's long-press, a right click) opens it
 * too, without the browser's own menu. The click that ends a hold is eaten.
 */
function useTabHold(onHold: (section: Section) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancel, []);
  return (section: Section) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      held.current = false;
      cancel();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        held.current = true;
        cancel();
        onHold(section);
      }, SLOT_PICK_HOLD_MS);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > HOLD_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      cancel();
      held.current = true;
      onHold(section);
    },
    /** True (once) when the click is the end of a hold, so it shouldn't switch tabs. */
    endedHold: () => {
      const was = held.current;
      held.current = false;
      return was;
    },
  });
}

interface SpaceGridProps {
  /** Every visible section, in order; the first ones are the bar's (splitTabBar). */
  sections: Section[];
  currentSectionId: string;
  overdueCount: number;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Saves a rearranged grid: every visible section's id, in its new order. */
  onReorder: (ids: string[]) => void;
  onOpen: (section: Section) => void;
}

// A finger or mouse that travels this far while rearranging is dragging.
const DRAG_SLOP_PX = 4;

interface Press {
  id: string;
  pointerId: number;
  /** Where the pointer went down, and where it is now. */
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** The tile's cell origin when it was picked up. */
  ox: number;
  oy: number;
  dragging: boolean;
  slot: number;
}

/**
 * The More sheet's All spaces grid (twin of apps/mobile's
 * section-switcher-sheet.tsx). Hold a tile to rearrange (Guy, Oct 21: "like
 * iPhone home screen"): the grid jiggles and any tile drags to a new spot.
 * The grid is the section order, so its first slots are the tab bar; while
 * rearranging they sit on a dock. Tiles sit in their cells by transform, so
 * a reorder glides them at base and the dragged one follows the pointer 1:1
 * (Hearth §8 "Rearrange"). The hold is timed off the pointer, like a tab's
 * (iOS Safari has no long-press event); contextmenu (a right click) starts
 * it too.
 */
function SpaceGrid({
  sections,
  currentSectionId,
  overdueCount,
  editing,
  onEditingChange,
  onReorder,
  onOpen,
}: SpaceGridProps) {
  // The grid's order while it differs from what's saved (a drag in
  // progress, or a save on its way back).
  const [draft, setDraft] = useState<Section[] | null>(null);
  const grid = draft ?? sections;
  const barCount = splitTabBar(grid).primary.length;
  const savedKey = sections.map((s) => s.id).join(",");
  useEffect(() => {
    setDraft((d) => (d && d.map((s) => s.id).join(",") === savedKey ? null : d));
  }, [savedKey]);
  useEffect(() => {
    if (!editing) setDraft(null);
  }, [editing]);

  const gridRef = useRef<HTMLDivElement>(null);
  const [cellWidth, setCellWidth] = useState(0);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setCellWidth(el.clientWidth / SPACE_GRID_COLUMNS);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const orderRef = useRef(grid);
  orderRef.current = grid;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The click that ends a hold or a drag doesn't open the space.
  const eatClick = useRef(false);

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(null);
  };
  useEffect(() => clearHold, []);

  const pickUp = (p: Press) => {
    p.dragging = true;
    eatClick.current = true;
    setDrag({ id: p.id, x: p.ox, y: p.oy });
  };

  const moveTo = (p: Press) => {
    const x = p.ox + p.x - p.x0;
    const y = p.oy + p.y - p.y0;
    setDrag({ id: p.id, x, y });
    const list = orderRef.current;
    const over = spaceGridSlotAt(x + cellWidth / 2, y + SPACE_GRID_CELL_HEIGHT / 2, cellWidth, list.length);
    if (over === p.slot) return;
    p.slot = over;
    const from = list.findIndex((s) => s.id === p.id);
    if (from === -1 || from === over) return;
    haptics.tick();
    const next = moveItem(list, from, over);
    orderRef.current = next;
    setDraft(next);
  };

  const drop = () => {
    const p = press.current;
    press.current = null;
    clearHold();
    if (!p?.dragging) return;
    haptics.commit();
    setDrag(null);
    const list = orderRef.current;
    if (list.map((s) => s.id).join(",") !== savedKey) {
      setDraft(list);
      onReorder(list.map((s) => s.id));
    }
  };

  // A held touch that starts to move is a drag, not a scroll, and not a pull
  // on the sheet: keep both out of it (non-passive, so it can say no).
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (!press.current?.dragging && !editingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const tileHandlers = (section: Section, index: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      eatClick.current = false;
      clearHold();
      const origin = spaceGridCellOrigin(index, cellWidth);
      const p: Press = {
        id: section.id,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        ox: origin.x,
        oy: origin.y,
        dragging: false,
        slot: index,
      };
      press.current = p;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser already let go of: nothing to follow.
      }
      if (editingRef.current) return;
      setHolding(section.id);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        setHolding(null);
        if (press.current !== p) return;
        haptics.commit();
        onEditingChange(true);
        pickUp(p);
      }, REARRANGE_HOLD_MS);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (p.dragging) {
        moveTo(p);
        return;
      }
      if (Math.hypot(p.x - p.x0, p.y - p.y0) <= (editingRef.current ? DRAG_SLOP_PX : HOLD_SLOP_PX)) return;
      if (editingRef.current) {
        haptics.tick();
        pickUp(p);
        moveTo(p);
      } else {
        // Moved before the hold landed: a scroll, not a hold.
        clearHold();
        press.current = null;
      }
    },
    onPointerUp: drop,
    onPointerCancel: drop,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      if (editingRef.current || press.current?.dragging) return;
      clearHold();
      press.current = null;
      eatClick.current = true;
      haptics.commit();
      onEditingChange(true);
    },
    onClick: () => {
      if (eatClick.current) {
        eatClick.current = false;
        return;
      }
      // While rearranging a tap does nothing (Done ends it).
      if (!editingRef.current) onOpen(section);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      // Keyboard rearranging: arrows step the focused tile one place.
      if (!editingRef.current) return;
      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      const list = orderRef.current;
      const to = index + step;
      if (to < 0 || to >= list.length) return;
      const next = moveItem(list, index, to);
      setDraft(next);
      onReorder(next.map((s) => s.id));
    },
  });

  return (
    <div
      ref={gridRef}
      className="relative"
      style={{ height: spaceGridRows(grid.length) * SPACE_GRID_CELL_HEIGHT }}
    >
      {/* While rearranging, the bar's slots sit on a dock, like a phone's
          home screen: drop a space here to put it in the bar. */}
      {editing && cellWidth > 0 && barCount < grid.length && (
        <div
          aria-hidden
          className="absolute left-0 top-0 rounded-3xl bg-secondary animate-in fade-in duration-[var(--motion-fast)]"
          style={{ width: cellWidth * barCount, height: SPACE_GRID_CELL_HEIGHT }}
        />
      )}
      {cellWidth > 0 &&
        grid.map((section, index) => {
          const active = section.id === currentSectionId;
          const inBar = index < barCount;
          const Icon = sectionIcons[section.iconId];
          const showBadge = overdueCount > 0 && section.navItems.some((i) => i.badge === "overdueTasks");
          const dragged = drag?.id === section.id;
          const origin = dragged ? drag : spaceGridCellOrigin(index, cellWidth);
          // Same language as the tab bar: each section leads with its own
          // identity tile; the current one names itself in its glyph hue.
          // §13.0: the tile never carries a badge, so the count trails the
          // label (as on native).
          return (
            <button
              key={section.id}
              data-hue={sectionHue(section.id)}
              aria-current={active ? "page" : undefined}
              aria-label={[section.label, inBar ? "in bar" : null, showBadge ? `${overdueCount} overdue` : null]
                .filter(Boolean)
                .join(", ")}
              {...tileHandlers(section, index)}
              className={cn(
                "absolute left-0 top-0 select-none [-webkit-touch-callout:none]",
                editing && "touch-none",
                dragged
                  ? "z-10"
                  : "transition-transform duration-[var(--motion-base)] ease-[var(--motion-ease-out)] motion-reduce:transition-none"
              )}
              style={{
                width: cellWidth,
                height: SPACE_GRID_CELL_HEIGHT,
                transform: `translate(${origin.x}px, ${origin.y}px)`,
              }}
            >
              <span
                className={cn(
                  "flex h-full flex-col items-center gap-2 rounded-xl px-1 py-1.5 transition-transform",
                  dragged
                    ? "scale-[1.12] duration-[var(--motion-fast)]"
                    : holding === section.id
                      ? "scale-[0.94] duration-[450ms]"
                      : "duration-[var(--motion-fast)] active:scale-[0.95]"
                )}
              >
                <span
                  className={cn(
                    "flex flex-col items-center gap-2",
                    editing && !dragged && "space-jiggle motion-reduce:animate-none",
                    editing && index % 2 === 1 && "space-jiggle-alt"
                  )}
                >
                  <LeadingTile
                    sectionId={section.id}
                    Icon={Icon}
                    size="xl"
                    className={cn(inBar && "!bg-transparent ring-[1.5px] ring-inset ring-[var(--hue-glyph)]")}
                  />
                  <span className="flex items-center gap-1">
                    <span
                      className={cn(
                        "line-clamp-2 text-center text-xs leading-tight",
                        active
                          ? "font-semibold text-[var(--hue-glyph)]"
                          : inBar
                            ? "font-medium text-muted-foreground"
                            : "font-medium text-foreground"
                      )}
                    >
                      {section.label}
                    </span>
                    {showBadge && (
                      <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums leading-none text-white">
                        {overdueCount}
                      </span>
                    )}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
    </div>
  );
}

/**
 * Mobile: bottom tab bar with balanced 2·+·2 layout.
 * Primary = first 3 visible sections (or all 4, if exactly 4 are visible); any
 * remaining overflow sections live behind a "More" tab that opens a bottom sheet.
 * With ≤4 sections all render inline and no More tab appears.
 * The FAB center slot is always dead-center regardless of section count.
 */
export function SectionTabBar({
  enabledSections,
  allSections,
  hiddenSectionIds,
  onChooseForSlot,
  onReorder,
  currentSectionId,
  onSelect,
  overdueCount,
}: TabBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [rearranging, setRearranging] = useState(false);
  useEffect(() => {
    if (!moreOpen) setRearranging(false);
  }, [moreOpen]);
  const [slotPick, setSlotPick] = useState<Section | null>(null);
  const hold = useTabHold(setSlotPick);

  // Fixed 2·+·2 split: show 3 primary tabs (2 left + 1 right), overflow → More.
  // Exactly 4 visible sections would otherwise produce a single-item More sheet,
  // so all 4 render inline instead (2 left + 2 right) and overflow stays empty.
  const { primary, overflow } = splitTabBar(enabledSections);
  const barSectionIds = new Set(primary.map((s) => s.id));

  // The More sheet's Recent strip (core recent-sections.ts): this device's
  // last-opened spaces, never the bar's own or the one you're on.
  useEffect(() => {
    try {
      initRecentSections(window.localStorage);
    } catch {
      // Storage blocked: the strip just stays empty.
    }
  }, []);
  useEffect(() => {
    recordRecentSection(currentSectionId);
  }, [currentSectionId]);
  const recentIds = useRecentSectionIds();
  const recentSections = pickRecentSections(
    recentIds,
    enabledSections,
    new Set([...barSectionIds, currentSectionId])
  );
  const hasBarTiles = enabledSections.some((s) => barSectionIds.has(s.id));

  const leftTabs = primary.slice(0, 2);
  const rightPrimary = primary.slice(2); // the 3rd primary section (if it exists)

  // If a remote settings change drops overflow to empty while the sheet is open
  // (e.g. a section got hidden elsewhere), the Sheet unmounts but `moreOpen` was
  // never cleared — if overflow returns later, the sheet would spring open
  // unprompted. Reset it here instead.
  useEffect(() => {
    if (overflow.length === 0 && moreOpen) setMoreOpen(false);
  }, [overflow.length, moreOpen]);

  // The active section, when it lives behind More: the More tab then wears
  // that section's hue, so the bar still says where you are.
  const activeOverflow = overflow.find((s) => s.id === currentSectionId);
  const moreActive = !!activeOverflow;
  const overflowHasOverdueTasks = overflow.some((s) =>
    s.navItems.some((i) => i.badge === "overdueTasks")
  );

  // Hearth §8 "Tab glide": one pebble behind the bar travels to whichever
  // tab is active (a primary tab, or More when the active section lives
  // behind it). Each tab registers its button so the bar can find the
  // active face's centre.
  const activeKey = moreActive ? "more" : primary.some((s) => s.id === currentSectionId) ? currentSectionId : null;
  const barRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabRef = useCallback(
    (key: string) => (el: HTMLButtonElement | null) => {
      if (el) tabRefs.current.set(key, el);
      else tabRefs.current.delete(key);
    },
    []
  );
  const [glideTarget, setGlideTarget] = useState<TabGlideTarget | null>(null);
  const tabKeys = [...primary.map((s) => s.id), overflow.length > 0 ? "more" : ""].join(",");
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const tab = activeKey ? tabRefs.current.get(activeKey) : undefined;
      if (!tab) {
        setGlideTarget(null);
        return;
      }
      const box = bar.getBoundingClientRect();
      const r = tab.getBoundingClientRect();
      // The face sits between the tab's pt-1.5 and pb-2, a pixel above centre.
      const next = { cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 - 1 };
      setGlideTarget((prev) => (prev && prev.cx === next.cx && prev.cy === next.cy ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [activeKey, tabKeys]);

  // The tab the user just arrived at gets one small pop of its glyph (not on
  // first paint: arriving is the event, not being there).
  const [arrival, setArrival] = useState<{ key: string | null; popped: string | null }>({
    key: activeKey,
    popped: null,
  });
  if (arrival.key !== activeKey) {
    setArrival({ key: activeKey, popped: activeKey });
  }

  // Hearth v2 (H2, navigation): each tab's glyph wears its section's identity
  // hue (core section-hues.ts via `data-hue`). The active tab sits on the
  // gliding pebble in its own tile hue with its label in the glyph hue;
  // inactive labels stay muted. Mirrors apps/mobile's primary-tab-bar.tsx.
  const renderTab = (section: Section) => {
    const active = section.id === currentSectionId;
    const Icon = sectionIcons[section.iconId];
    const showBadge =
      overdueCount > 0 && section.navItems.some((item) => item.badge === "overdueTasks");
    const { endedHold, ...holdHandlers } = hold(section);
    return (
      <button
        key={section.id}
        ref={tabRef(section.id)}
        data-hue={sectionHue(section.id)}
        {...holdHandlers}
        onClick={() => {
          if (endedHold()) return;
          onSelect(section.id);
        }}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex min-w-11 select-none flex-col [-webkit-touch-callout:none] items-center gap-0.5 pt-1.5 pb-2 transition-[color,scale] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] active:scale-[0.94]",
          active ? "text-[var(--hue-glyph)]" : "text-muted-foreground"
        )}
      >
        <span className="relative flex items-center justify-center h-7 w-12">
          <Icon
            className={cn("h-5 w-5 text-[var(--hue-glyph)]", arrival.popped === section.id && "tab-arrive")}
          />
          {showBadge && (
            <span className="absolute -top-0.5 right-1 inline-flex min-w-[1rem] h-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-white">
              {overdueCount}
            </span>
          )}
        </span>
        <span className={cn("text-[10px] leading-none", active ? "font-semibold" : "font-medium")}>
          {section.shortLabel}
        </span>
      </button>
    );
  };

  const moreTab = overflow.length > 0 && (
    <button
      ref={tabRef("more")}
      data-hue={activeOverflow ? sectionHue(activeOverflow.id) : undefined}
      onClick={() => setMoreOpen(true)}
      aria-current={moreActive ? "page" : undefined}
      className={cn(
        "relative flex min-w-11 flex-col items-center gap-0.5 pt-1.5 pb-2 transition-[color,scale] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] active:scale-[0.94]",
        moreActive ? "text-[var(--hue-glyph)]" : "text-muted-foreground"
      )}
    >
      <span className="relative flex items-center justify-center h-7 w-12">
        <MoreHorizontal className={cn("h-5 w-5", arrival.popped === "more" && "tab-arrive")} />
        {overdueCount > 0 && overflowHasOverdueTasks && (
          <span className="absolute -top-0.5 right-1 inline-flex min-w-[1rem] h-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-white">
            {overdueCount}
          </span>
        )}
      </span>
      <span className={cn("text-[10px] leading-none", moreActive ? "font-semibold" : "font-medium")}>
        More
      </span>
    </button>
  );

  return (
    <>
      <nav
        aria-label="Sections"
        className="md:hidden relative z-30 shrink-0 border-t border-border/60 bg-background/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      >
        <div ref={barRef} className="relative flex items-stretch">
          <TabGlide
            target={glideTarget}
            hue={activeOverflow ? sectionHue(activeOverflow.id) : sectionHue(currentSectionId)}
          />
          {/* Left group: first 2 primary tabs */}
          <div className="flex flex-1 justify-around">{leftTabs.map(renderTab)}</div>
          {/* Dedicated, always-centered slot the raised "+" lives in. */}
          <div className="relative w-16 shrink-0">
            <MobileCaptureFab />
            {/* FLUX-1570: the dock's meridian tick — anchored near the bottom of
                this column, clear of the FAB's -top-5/48px footprint. */}
            <MeridianAxis variant="dock" />
          </div>
          {/* Right group: 3rd primary tab + More (if overflow exists) */}
          <div className="flex flex-1 justify-around">
            {rightPrimary.map(renderTab)}
            {moreTab}
          </div>
        </div>
      </nav>

      {overflow.length > 0 && (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" open={moreOpen} onOpenChange={setMoreOpen}>
            {/* pr-12 keeps the hint and Done clear of the sheet's close button. */}
            <SheetHeader className="flex-row items-center justify-between pr-12">
              <SheetTitle>More</SheetTitle>
              {rearranging ? (
                <button
                  onClick={() => setRearranging(false)}
                  className="text-[13px] font-semibold text-primary hover:underline"
                >
                  Done
                </button>
              ) : (
                enabledSections.length > 1 && (
                  <span className="text-xs text-muted-foreground">Hold an icon to rearrange</span>
                )
              )}
            </SheetHeader>
            <div className="px-4 pb-4">
              {/* Guy's pick (Oct 21), twin of apps/mobile's
                  section-switcher-sheet.tsx: a Recent strip, then every
                  visible section as a 4-across tile grid so each keeps a
                  fixed spot; the bar's own wear an outlined tile. */}
              {recentSections.length > 0 && (
                <div className="pb-4">
                  <p className={MICRO_LABEL}>Recent</p>
                  <div className="grid grid-cols-3 gap-2">
                    {recentSections.map((section) => {
                      const Icon = sectionIcons[section.iconId];
                      return (
                        <button
                          key={section.id}
                          onClick={() => {
                            onSelect(section.id);
                            suppressNextSheetTidy();
                            setMoreOpen(false);
                          }}
                          className="flex min-h-12 items-center gap-2 rounded-2xl border border-border bg-card px-2.5 text-left text-[13px] font-medium leading-tight text-foreground transition-transform active:scale-[0.97]"
                        >
                          <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />
                          <span className="line-clamp-2 min-w-0">{section.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {recentSections.length > 0 && <p className={MICRO_LABEL}>All spaces</p>}
              <SpaceGrid
                sections={enabledSections}
                currentSectionId={currentSectionId}
                overdueCount={overdueCount}
                editing={rearranging}
                onEditingChange={setRearranging}
                onReorder={onReorder}
                onOpen={(section) => {
                  onSelect(section.id);
                  suppressNextSheetTidy();
                  setMoreOpen(false);
                }}
              />
              {/* Settings always lands on the settings menu (HOUP-50 bug 2),
                  matching the sidebar/drawer's menu-first behaviour. */}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                {rearranging ? (
                  <span className="text-xs text-muted-foreground">Drag a space onto the dock to put it in your bar</span>
                ) : hasBarTiles ? (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden className="size-3.5 rounded-[5px] border-[1.5px] border-muted-foreground" />
                    Outlined: already in your bar
                  </span>
                ) : (
                  <span />
                )}
                <Link
                  href="/settings"
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium text-foreground transition-transform active:scale-[0.97]"
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Settings
                </Link>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      <Sheet open={!!slotPick} onOpenChange={(open) => !open && setSlotPick(null)}>
        <SheetContent side="bottom" open={!!slotPick} onOpenChange={(open) => !open && setSlotPick(null)}>
          <SheetHeader>
            <SheetTitle>Choose a tab</SheetTitle>
            {slotPick && <p className="text-xs text-muted-foreground">In place of {slotPick.label}</p>}
          </SheetHeader>
          <div className="px-2 pb-4 space-y-1">
            {allSections.map((section) => {
              const Icon = sectionIcons[section.iconId];
              const here = section.id === slotPick?.id;
              const note = here
                ? null
                : barSectionIds.has(section.id)
                  ? "In bar"
                  : hiddenSectionIds.includes(section.id)
                    ? "Hidden"
                    : null;
              return (
                <button
                  key={section.id}
                  aria-current={here ? "true" : undefined}
                  onClick={() => {
                    const slot = slotPick;
                    setSlotPick(null);
                    if (slot) onChooseForSlot(slot.id, section.id);
                  }}
                  className={cn(
                    "w-full flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    here ? "font-semibold text-foreground" : "text-foreground/70 hover:text-foreground hover:bg-accent/60"
                  )}
                >
                  <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
                  {here && <Check className="h-[18px] w-[18px] shrink-0 text-primary" />}
                  {note && <span className="shrink-0 text-xs font-normal text-muted-foreground">{note}</span>}
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
