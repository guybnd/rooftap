// HOUP-198: extracted from task-row.tsx's ad hoc startHoldFill/stopHoldFill
// (HOUP-144) so setup/grocery rows can drive the same `holdProgress` arming
// fill without copy-pasting the RAF ramp a second and third time (flagged as
// a "consider" item on HOUP-190). Decoupled from *how* the long-press is
// detected — callers wire `start`/`stop` to that mechanism's press begin/end
// (a Pressable's onPressIn/onPressOut, or SwipeActions' onHoldStart/onHoldEnd).
import { useCallback, useEffect, useRef, useState } from 'react';
import { HOLD_CHARGE_STEPS, stepsCrossed } from '@homeup/core';
import { charge } from '../lib/haptics';

export interface UseHoldFillResult {
  /** 0->1 hold-to-edit arming progress — feed straight into `ListItem`'s `holdProgress`. */
  progress: number;
  /** Call on press/gesture begin to start the ramp. */
  start: () => void;
  /** Call on press/gesture end (release, cancel, or resolved) to reset the ramp. */
  stop: () => void;
}

/**
 * Ramps 0->1 over `durationMs`, after an initial `delayMs` grace (so a quick
 * tap never flashes the fill) — reaching 1 exactly as the paired long-press
 * fires. The fill charges as it sweeps (Hearth §9): a soft buzz, then a
 * light one, at HOLD_CHARGE_STEPS, so the caller's commit() lands as the
 * third and firmest beat. A lift before a step stays silent.
 */
export function useHoldFill(durationMs: number, delayMs = 100): UseHoldFillResult {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);

  const stop = useCallback(() => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    setProgress(0);
  }, []);

  const start = useCallback(() => {
    startedAt.current = Date.now();
    const denom = durationMs - delayMs;
    let last = 0;
    const tick = () => {
      const elapsed = Date.now() - startedAt.current;
      const p = Math.min(1, Math.max(0, (elapsed - delayMs) / denom));
      stepsCrossed(HOLD_CHARGE_STEPS, last, p).forEach(charge);
      last = p;
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [durationMs, delayMs]);

  useEffect(() => stop, [stop]);

  return { progress, start, stop };
}
