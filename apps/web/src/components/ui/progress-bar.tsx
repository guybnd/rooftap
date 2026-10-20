"use client";

// FLUX-189: a small shared fill bar. Extracted for the recipe "ingredients you
// have" bar; reusable by any "N of M" progress surface. No shared bar existed
// before (every prior bar was bespoke inline markup).

import { cn } from "@/lib/utils";

interface ProgressBarProps {
  /** Numerator (e.g. ingredients you have). */
  value: number;
  /** Denominator (e.g. total ingredients). 0 renders an empty bar (no NaN). */
  total: number;
  /** Bar fill colour class. Default success (theme token). */
  fillClassName?: string;
  /** Track background class. */
  trackClassName?: string;
  className?: string;
}

export function ProgressBar({
  value,
  total,
  fillClassName = "bg-success",
  trackClassName = "bg-muted",
  className,
}: ProgressBarProps) {
  const pct = total > 0 ? Math.round((Math.min(value, total) / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
      className={cn("h-1.5 w-full overflow-hidden rounded-full", trackClassName, className)}
    >
      <div
        className={cn("h-full rounded-full transition-all", fillClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
