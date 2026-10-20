"use client";

// FLUX-182: a compact 3-stop slider for Low / Medium / High priority, used by the
// to-do and setup modals. Implemented on a native range input (min 0, max 2,
// step 1) so it's keyboard- and touch-accessible for free; the three stops are
// labelled below and the active label is tinted by severity.

import * as React from "react";
import { cn } from "@/lib/utils";

export type Priority = "low" | "medium" | "high";

const ORDER: Priority[] = ["low", "medium", "high"];
const LABEL: Record<Priority, string> = { low: "Low", medium: "Med", high: "High" };
const ACTIVE_COLOR: Record<Priority, string> = {
  low: "text-muted-foreground",
  medium: "text-warning",
  high: "text-destructive",
};
const ACCENT: Record<Priority, string> = {
  low: "accent-muted-foreground",
  medium: "accent-warning",
  high: "accent-destructive",
};

interface PrioritySliderProps {
  value: Priority;
  onChange: (value: Priority) => void;
  ariaLabel?: string;
  className?: string;
  id?: string;
}

export function PrioritySlider({ value, onChange, ariaLabel, className, id }: PrioritySliderProps) {
  const index = Math.max(0, ORDER.indexOf(value));

  return (
    <div className={cn("space-y-1", className)}>
      <input
        id={id}
        type="range"
        min={0}
        max={2}
        step={1}
        value={index}
        aria-label={ariaLabel}
        aria-valuetext={LABEL[value]}
        onChange={(e) => onChange(ORDER[Number(e.target.value)] ?? "medium")}
        className={cn("h-2 w-full cursor-pointer", ACCENT[value])}
      />
      <div className="flex justify-between px-0.5 text-[11px] font-medium">
        {ORDER.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "transition-colors",
              p === value ? ACTIVE_COLOR[p] : "text-muted-foreground/50 hover:text-muted-foreground"
            )}
          >
            {LABEL[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
