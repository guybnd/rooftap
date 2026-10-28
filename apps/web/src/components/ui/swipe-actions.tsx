'use client';

// FLUX-217: the ONE swipe-action implementation, generalized out of what was
// groceries/swipeable-card.tsx. Configurable leading/trailing (right/left) swipe
// actions with swipe-vs-scroll gesture arbitration live here, once, for every
// row consumer (groceries, the Today hero, and future ones).

import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { tick } from '@/lib/haptics';

export interface SwipeConfig {
  /** Background tint shown while dragging below the trigger threshold. */
  bg: string;
  /** Stronger background once past the trigger threshold (action will fire). */
  activeBg: string;
  /** Icon revealed behind the card. */
  icon: ReactNode;
  /** Short action label shown beside the icon (e.g. "Got it", "Uncheck"). */
  label?: string;
}

interface Props {
  children: ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  right?: SwipeConfig;
  left?: SwipeConfig;
  disabled?: boolean;
}

const START = 8;     // px of movement before a gesture is treated as a swipe
const TRIGGER = 72;  // px past which the action fires on release
const MAX = 200;     // px clamp

// Elements that own their own pointer interaction — swipe must not start on them.
const NO_SWIPE = 'button, input, textarea, select, a, label, [data-no-swipe]';

export function SwipeActions({ children, onSwipeRight, onSwipeLeft, right, left, disabled }: Props) {
  const [offset, setOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const isSwiping = useRef(false);
  const didSwipe = useRef(false);
  const crossedTrigger = useRef(false);

  const clamp = (v: number) => Math.max(-MAX, Math.min(MAX, v));

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    // A right-click is the row's context menu, not a swipe: capturing the
    // pointer here would retarget the contextmenu event to this wrapper,
    // past the row that handles it.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest(NO_SWIPE)) return; // let the control handle it
    startX.current = e.clientX;
    isSwiping.current = false;
    didSwipe.current = false;
    crossedTrigger.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current === null) return;
    // Without a capture yet, a mouse released off the row never sent its
    // pointerup here: a move with no button down ends that press.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      startX.current = null;
      return;
    }
    const dx = e.clientX - startX.current;
    if (!isSwiping.current && Math.abs(dx) > START) {
      isSwiping.current = true;
      // Capture only once it is a swipe. A capture from the press itself
      // sends the release to this wrapper, so the browser fires the click
      // on the wrapper instead of the row, and a plain mouse click on a
      // row (open its checklist, open an event) did nothing.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (!isSwiping.current) return;
    e.preventDefault();
    // Only allow directions that have a handler.
    const next = dx > 0 ? (onSwipeRight ? dx : 0) : (onSwipeLeft ? dx : 0);
    // Hearth §9: a tick right as the drag crosses the trigger threshold — the
    // detent that tells you the release will fire the action. Re-arms if the
    // drag retreats back below the threshold, so re-crossing ticks again.
    const past = Math.abs(next) >= TRIGGER;
    if (past && !crossedTrigger.current) tick();
    crossedTrigger.current = past;
    setOffset(clamp(next));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (startX.current === null) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    startX.current = null;
    didSwipe.current = isSwiping.current;
    const o = offset;
    if (o >= TRIGGER) onSwipeRight?.();
    else if (o <= -TRIGGER) onSwipeLeft?.();
    setOffset(0);
  };

  // Suppress the click that follows a swipe (so tapping name-edit etc. doesn't fire).
  const onClickCapture = (e: React.MouseEvent) => {
    if (didSwipe.current) {
      e.preventDefault();
      e.stopPropagation();
      didSwipe.current = false;
    }
  };

  const abs = Math.abs(offset);
  const active = abs >= TRIGGER;
  const cfg = offset > 0 ? right : offset < 0 ? left : undefined;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Background action layer */}
      {abs > START && cfg && (
        <div
          className={cn(
            'absolute inset-0 flex items-center rounded-2xl transition-colors duration-[var(--motion-base)] ease-[var(--motion-ease-out)]',
            active ? cfg.activeBg : cfg.bg,
            offset > 0 ? 'justify-start pl-4' : 'justify-end pr-4'
          )}
          role={cfg.label ? 'status' : undefined}
          aria-label={cfg.label}
        >
          <span
            className={cn(
              'flex items-center gap-2 text-white font-semibold text-sm transition-all duration-[var(--motion-base)] ease-[var(--motion-ease-out)]',
              active ? 'opacity-100 scale-105' : 'opacity-70 scale-100'
            )}
          >
            <span aria-hidden="true">{cfg.icon}</span>
            {cfg.label && <span className="whitespace-nowrap tracking-tight">{cfg.label}</span>}
          </span>
        </div>
      )}

      {/* Sliding card */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: startX.current ? 'none' : 'transform var(--motion-base) var(--motion-ease-out)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        className="touch-pan-y relative z-10 select-none [-webkit-touch-callout:none]"
      >
        {children}
      </div>
    </div>
  );
}
