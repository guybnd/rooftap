'use client';

// Hearth §13 "Living edge" on web: turns the .spectrum-edge ring (globals.css)
// and sets its width each frame, easing between paces the way the phone's
// SpectrumEdge does (packages/ui/src/components/spectrum-edge.tsx), so both
// read core's ASSISTANT_EDGE_* the same way. Reduced motion holds it still.
import { useEffect, useRef, type RefObject } from 'react';
import {
  ASSISTANT_EDGE_EASE_MS,
  ASSISTANT_EDGE_TURN_MS,
  ASSISTANT_EDGE_WIDTH,
  ASSISTANT_EDGE_WOBBLE,
  type AssistantEdgePace,
} from '@homeup/core';

export function useSpectrumEdge(ref: RefObject<HTMLElement | null>, pace: AssistantEdgePace, active: boolean) {
  const paceRef = useRef(pace);
  paceRef.current = pace;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let speed = 360 / ASSISTANT_EDGE_TURN_MS[paceRef.current];
    let width: number = ASSISTANT_EDGE_WIDTH[paceRef.current];
    let wobble = paceRef.current === 'thinking' ? 1 : 0;
    let angle = 0;
    let clock = 0;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const p = paceRef.current;
      if (still.matches) {
        width = ASSISTANT_EDGE_WIDTH[p];
        wobble = 0;
      } else {
        const k = Math.min(1, dt / (ASSISTANT_EDGE_EASE_MS / 3));
        speed += (360 / ASSISTANT_EDGE_TURN_MS[p] - speed) * k;
        width += (ASSISTANT_EDGE_WIDTH[p] - width) * k;
        wobble += ((p === 'thinking' ? 1 : 0) - wobble) * k;
        angle = (angle + speed * dt) % 360;
        clock = (clock + dt) % ASSISTANT_EDGE_WOBBLE.periodMs;
      }
      const w = width + wobble * ASSISTANT_EDGE_WOBBLE.px * Math.sin((clock / ASSISTANT_EDGE_WOBBLE.periodMs) * Math.PI * 2);
      el.style.setProperty('--edge-angle', `${angle.toFixed(2)}deg`);
      el.style.setProperty('--edge-w', `${w.toFixed(2)}px`);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref, active]);
}
