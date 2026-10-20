import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";
import { tick } from "@/lib/haptics";

// Shared by every bottom-sheet-style surface in the app (PopMenu's mobile
// sheet, ItemFormSheet, the generic Sheet primitive's side="bottom" variant)
// so drag-to-dismiss and back-button behaviour is implemented exactly once.

const DISMISS_THRESHOLD = 110;
/** Downward pixels of travel before a content-area drag "commits" to being a
 *  dismiss (vs. an ordinary scroll) — small, just enough to reject jitter. */
const CONTENT_COMMIT_THRESHOLD = 6;

/**
 * The inline style a dragging sheet needs, centralised so every consumer
 * applies it identically. Disables BOTH `transition` and `animation` while
 * dragging — they're separate CSS mechanisms and `transition: none` alone
 * does nothing to a still-running entrance keyframe animation.
 */
export function dragDismissStyle(dragY: number, dragging: boolean): CSSProperties {
  if (dragY > 0) return { transform: `translateY(${dragY}px)`, transition: "none", animation: "none" };
  if (dragging) return { transition: "none", animation: "none" };
  return {};
}

/**
 * Drag-to-dismiss for a bottom sheet. Two triggers, like a native sheet:
 *
 *  - `handleHandlers` — React pointer handlers for the dedicated handle bar.
 *    The bar carries `touch-action: none`, so the browser never claims the
 *    gesture and pointer events survive. Any downward drag dismisses past
 *    the threshold.
 *
 *  - `contentRef` — attach to the scrollable body. Uses NATIVE touch
 *    listeners (`passive: false`), not React pointer events: on a touch
 *    device the browser fires `pointercancel` and takes over the moment it
 *    decides the gesture is a scroll (which `touch-action` defaults allow on
 *    buttons/inputs/scrollables), so pointer events are structurally unable
 *    to implement pull-past-top — they die after a few frames. A non-passive
 *    touchmove that calls `preventDefault()` once the pull commits is the
 *    one mechanism that beats native scrolling to the gesture. The pull only
 *    commits when the content is already at `scrollTop <= 0` and moving
 *    down; while scrolled, the start point re-bases so reaching the top
 *    mid-gesture and continuing to pull works in one motion.
 */
export function useSheetDragDismiss(onDismiss: () => void) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragYRef = useRef(0);
  const activeRef = useRef(false);
  const startYRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  // Hearth §9: a tick right as the drag crosses the dismiss line — re-arms if
  // the drag retreats back above it, mirroring swipe-actions' threshold tick.
  const crossedDismissRef = useRef(false);

  const setDrag = (y: number) => {
    dragYRef.current = y;
    setDragY(y);
    const past = y > DISMISS_THRESHOLD;
    if (past && !crossedDismissRef.current) tick();
    crossedDismissRef.current = past;
  };

  const endDrag = useCallback(() => {
    const shouldDismiss = activeRef.current && dragYRef.current > DISMISS_THRESHOLD;
    activeRef.current = false;
    startYRef.current = null;
    crossedDismissRef.current = false;
    setDragging(false);
    setDrag(0);
    if (shouldDismiss) onDismissRef.current();
  }, []);

  // ── Handle bar (pointer events + touch-action:none on the element) ──────
  const handleHandlers = {
    onPointerDown: (e: PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      startYRef.current = e.clientY;
      activeRef.current = true;
      setDragging(true);
    },
    onPointerMove: (e: PointerEvent) => {
      e.stopPropagation();
      if (!activeRef.current || startYRef.current == null) return;
      e.preventDefault();
      setDrag(Math.max(0, e.clientY - startYRef.current));
    },
    onPointerUp: (e: PointerEvent) => {
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      endDrag();
    },
  };

  // ── Scrollable content (native non-passive touch listeners) ─────────────
  const contentCleanup = useRef<(() => void) | null>(null);
  const contentRef = useCallback(
    (el: HTMLElement | null) => {
      contentCleanup.current?.();
      contentCleanup.current = null;
      if (!el) return;

      let startY: number | null = null;
      let startX = 0;
      let touchTarget: EventTarget | null = null;
      let active = false;
      let suppressClick = false;

      // Scrolled = the sheet body OR any scroller between the finger and it
      // (a bounded results list inside the sheet): pulling down there scrolls
      // that list back up, it doesn't dismiss the sheet.
      const isScrolled = () => {
        for (let n = touchTarget instanceof Element ? touchTarget : null; n; n = n.parentElement) {
          if (n.scrollTop > 0) return true;
          if (n === el) break;
        }
        return el.scrollTop > 0;
      };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        touchTarget = e.target;
        active = false;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (startY == null || e.touches.length !== 1) return;
        const y = e.touches[0].clientY;
        const x = e.touches[0].clientX;
        if (!active) {
          // While the content is scrolled, keep re-basing the start point so
          // a single gesture that scrolls to the top and keeps pulling turns
          // into a dismiss-drag from the top, not from where the finger began.
          if (isScrolled()) {
            startY = y;
            startX = x;
            return;
          }
          // A mostly sideways gesture is a row's swipe (SwipeActions), not a
          // pull: drop it for the rest of this touch, like the native sheet's
          // failOffsetX.
          const dx = Math.abs(x - startX);
          if (dx > CONTENT_COMMIT_THRESHOLD && dx >= Math.abs(y - startY)) {
            startY = null;
            return;
          }
          if (y - startY <= CONTENT_COMMIT_THRESHOLD) return;
          active = true;
          activeRef.current = true;
          suppressClick = true;
          setDragging(true);
        }
        // Committed: keep native scrolling out of it for the rest of the
        // gesture. preventDefault() here (non-passive) is what actually
        // stops the browser from scroll-hijacking the touch.
        e.preventDefault();
        setDrag(Math.max(0, y - startY));
      };

      const onTouchEnd = () => {
        startY = null;
        touchTarget = null;
        if (active) {
          active = false;
          endDrag();
          // A drag that travelled still ends in a click on whatever the
          // finger was over (a menu item, a button) — swallow it.
          setTimeout(() => {
            suppressClick = false;
          }, 350);
        } else {
          suppressClick = false;
        }
      };

      const onClickCapture = (e: MouseEvent) => {
        if (suppressClick) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchmove", onTouchMove, { passive: false });
      el.addEventListener("touchend", onTouchEnd, { passive: true });
      el.addEventListener("touchcancel", onTouchEnd, { passive: true });
      el.addEventListener("click", onClickCapture, true);
      contentCleanup.current = () => {
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", onTouchEnd);
        el.removeEventListener("touchcancel", onTouchEnd);
        el.removeEventListener("click", onClickCapture, true);
      };
    },
    [endDrag],
  );
  useEffect(() => () => contentCleanup.current?.(), []);

  return {
    dragY,
    dragging,
    handleHandlers: {
      ...handleHandlers,
      onPointerCancel: handleHandlers.onPointerUp,
    },
    contentRef,
  };
}

// ── Back-button interception ──────────────────────────────────────────────
//
// One module-level manager instead of per-hook history juggling. The naive
// per-instance version (push a marker on open, history.back() synchronously
// in the effect cleanup on close) caused two real production bugs:
//   - opening a modal FROM a menu: the menu's cleanup back() popped the
//     modal's freshly-pushed entry → the modal's own popstate listener
//     closed it one frame after it opened;
//   - navigating FROM a sheet: Next's router.push commits its pushState
//     asynchronously, so cleanup's synchronous back() raced it and undid
//     the navigation.
//
// Rules here:
//   - every open sheet pushes a marker entry {__sheet: id} and registers in
//     a stack; a real Back pops the top registration and closes that sheet.
//   - programmatic close only unregisters. Removing the marker entry is
//     deferred and guarded: only if, shortly after, the current history
//     entry is STILL this sheet's own marker (nothing else was pushed —
//     no navigation, no newly-opened sheet) do we history.back() to tidy it.
//   - stale markers (from sheets long closed) encountered later while no
//     sheet is open are skipped through automatically, so Back never turns
//     into a visible no-op press.

type SheetEntry = { id: number; onClose: () => void };
const sheetStack: SheetEntry[] = [];
let nextSheetId = 1;
let listenerInstalled = false;
const suppressedTidyIds = new Set<number>();

/**
 * Call synchronously from a click handler that both closes the top-of-stack
 * sheet AND triggers navigation (e.g. `router.push`) — tells the tidy-up
 * timer in `closeSheetEntry` to skip its `history.back()` for that sheet, so
 * it can't race and revert an in-flight (cold/uncached route) navigation.
 * The orphaned marker is left for the existing stale-marker skip-through in
 * the `popstate` listener to clean up. Only safe when called synchronously
 * in the same handler that closes the sheet — it targets whatever is
 * currently the top of `sheetStack`.
 */
export function suppressNextSheetTidy() {
  const top = sheetStack[sheetStack.length - 1];
  if (top) suppressedTidyIds.add(top.id);
}

function ensurePopstateListener() {
  if (listenerInstalled || typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("popstate", () => {
    const top = sheetStack.pop();
    if (top) top.onClose();
    // Landed on a stale marker with no sheet left open? Skip through so the
    // user never spends a Back press on an invisible entry. (Only when the
    // stack is empty — with a sheet still open, chaining another back()
    // would pop its registration too and close two things on one press.)
    const st = window.history.state;
    if (st?.__sheet != null && sheetStack.length === 0) {
      window.history.back();
    }
  });
}

function pushSheetEntry(onClose: () => void): number {
  ensurePopstateListener();
  const id = nextSheetId++;
  window.history.pushState({ __sheet: id }, "");
  sheetStack.push({ id, onClose });
  return id;
}

function closeSheetEntry(id: number) {
  const i = sheetStack.findIndex((e) => e.id === id);
  if (i >= 0) sheetStack.splice(i, 1);
  if (suppressedTidyIds.delete(id)) return;
  // Deferred + guarded tidy-up. The delay gives a same-tick router.push or
  // newly-opened sheet time to land its own pushState; if anything did, the
  // guard fails and the stale marker is left to the skip-through rule. Also
  // requires the stack to be empty: with another sheet still open, back()
  // would land on ITS marker and the popstate handler would close it.
  setTimeout(() => {
    // The page can be gone by now (a test's DOM torn down mid-delay).
    if (typeof window === 'undefined') return;
    if (sheetStack.length === 0 && window.history.state?.__sheet === id) {
      window.history.back();
    }
  }, 80);
}

/**
 * Android's back gesture/button (and desktop browser Back) closes the open
 * sheet instead of navigating the underlying page away.
 */
export function useCloseOnBack(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = pushSheetEntry(() => onCloseRef.current());
    return () => closeSheetEntry(id);
  }, [isOpen]);
}

// ── Page draw-back signal ─────────────────────────────────────────────────
// Hearth §8: the page behind a bottom sheet draws back (scale + dim) while
// the sheet is open. BottomSheet instances mount all over the app, so rather
// than threading sheet state up to the app shell, they register into one
// shared open-count here; AppSidebar (the shell that owns the content
// wrapper) subscribes with useAnySheetOpen. Same module-singleton shape as
// the back-button stack above, one level simpler (no ordering to track).
let openSheetCount = 0;
const drawBackListeners = new Set<() => void>();

function notifyDrawBack() {
  drawBackListeners.forEach((listener) => listener());
}

/** Call from any BottomSheet-like surface with its own `open` state. */
export function useSheetOpenSignal(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openSheetCount++;
    notifyDrawBack();
    return () => {
      openSheetCount--;
      notifyDrawBack();
    };
  }, [open]);
}

/** True while at least one BottomSheet is open anywhere in the app. */
export function useAnySheetOpen(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      drawBackListeners.add(onStoreChange);
      return () => drawBackListeners.delete(onStoreChange);
    },
    () => openSheetCount > 0,
    () => false
  );
}
