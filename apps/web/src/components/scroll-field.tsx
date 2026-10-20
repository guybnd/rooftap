"use client";

import { useCallback, useRef } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { tick } from "@/lib/haptics";

interface ScrollFieldProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
  pad?: number;
  step?: number;
  display?: string;
  wide?: boolean;
}

export function ScrollField({
  value,
  onChange,
  min,
  max,
  label,
  pad = 2,
  step = 1,
  display,
  wide,
}: ScrollFieldProps) {
  const triggerHaptic = useCallback(() => {
    tick();
  }, []);

  const increment = useCallback(() => {
    const next = value + step;
    onChange(next > max ? min : next);
    triggerHaptic();
  }, [value, step, max, min, onChange, triggerHaptic]);

  const decrement = useCallback(() => {
    const next = value - step;
    onChange(next < min ? max - (max % step || 0) + (min % step || 0) : next);
    triggerHaptic();
  }, [value, step, min, max, onChange, triggerHaptic]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) increment();
    else decrement();
  };

  const pointerStartY = useRef<number | null>(null);
  const accumulated = useRef(0);
  const DRAG_THRESHOLD = 20;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartY.current = e.clientY;
    accumulated.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerStartY.current === null) return;
    const delta = pointerStartY.current - e.clientY;
    const steps = Math.trunc((delta - accumulated.current) / DRAG_THRESHOLD);
    if (steps !== 0) {
      accumulated.current += steps * DRAG_THRESHOLD;
      if (steps > 0) for (let i = 0; i < steps; i++) increment();
      else for (let i = 0; i < -steps; i++) decrement();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartY.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={increment}
        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <div
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`${wide ? "w-12" : "w-10"} h-9 flex items-center justify-center rounded-md border bg-background text-sm font-medium tabular-nums cursor-ns-resize select-none touch-none`}
      >
        {display ?? String(value).padStart(pad, "0")}
      </div>
      <button
        type="button"
        onClick={decrement}
        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
