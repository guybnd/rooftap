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
  /** Where the value is expected to end up (e.g. paid so far, then what is still to come). Drawn faint past `value`. */
  expected?: number;
  /** Bar fill colour class. Default success (theme token). */
  fillClassName?: string;
  /** Track background class. */
  trackClassName?: string;
  className?: string;
}

export function ProgressBar({
  value,
  total,
  expected,
  fillClassName = "bg-success",
  trackClassName = "bg-muted",
  className,
}: ProgressBarProps) {
  const share = (n: number) => (total > 0 ? Math.round((Math.max(0, Math.min(n, total)) / total) * 100) : 0);
  const pct = share(value);
  const ahead = expected != null ? Math.max(0, share(expected) - pct) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
      className={cn("flex h-1.5 w-full overflow-hidden rounded-full", trackClassName, className)}
    >
      <div
        className={cn("h-full shrink-0 rounded-full transition-all", fillClassName)}
        style={{ width: `${pct}%` }}
      />
      {ahead > 0 ? (
        <div className={cn("h-full shrink-0 rounded-r-full opacity-30 transition-all", fillClassName)} style={{ width: `${ahead}%` }} />
      ) : null}
    </div>
  );
}
