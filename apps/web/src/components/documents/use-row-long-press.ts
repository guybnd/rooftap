'use client';

// FLUX-234: thin wrapper over the shared useLongPress that opens a Documents
// row's (or folder tile's) actions menu as a bottom sheet on hold, same
// pattern as cost-card.tsx. Moved out of app/documents/page.tsx so the folder
// tiles in folder-browser.tsx hold the same way the document rows do.

import { useCallback } from 'react';
import { useLongPress as useSharedLongPress, HOLD_FILL_DELAY_MS } from '@/hooks/use-long-press';

// FLUX-198/234: elements that own their own pointer interaction never start a
// hold (mirrors groceries'/costs' NO_HOLD: buttons/inputs/links/chips).
const NO_HOLD = 'button, input, textarea, select, a, label, [data-no-swipe]';

export function useRowLongPress(onFire: () => void) {
  const { handlers: shared, consumeClick, progress } = useSharedLongPress(onFire, true, {
    trackProgress: true,
    fillDelayMs: HOLD_FILL_DELAY_MS,
    moveCancelRatio: 0.1,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return; // desktop: the "more" button / right-click instead of hold
    // Presses inside a portalled menu or sheet bubble here through React's
    // tree; only a press on the row itself starts a hold.
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    shared.onPointerDown(e);
  }, [shared]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    e.preventDefault();
    onFire();
  }, [onFire]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (consumeClick()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [consumeClick]);

  return {
    progress,
    handlers: { onPointerDown, onContextMenu, onClickCapture },
  };
}

/** Stops a click or press from reaching the row or tile around it (which opens it) or starting its hold. */
export const stopRow = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onContextMenu: (e: React.SyntheticEvent) => e.stopPropagation(),
};
