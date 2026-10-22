"use client";

// FLUX-182: a themed segmented control used across the item modals for small
// exclusive choices — grocery status (Need / Have / Got), cost cadence, the
// recurrence unit pill (day / week / month), etc. Replaces the old bespoke
// `flex rounded border` toggle rows that hardcoded slate-* colours.

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Let segments wrap to a second line (for many options, e.g. cadence). */
  wrap?: boolean;
  size?: "sm" | "md";
  /** `accent` tints the chosen segment coral (Hearth: --primary marks what
   * is interactive and on), for a filter that should read at a glance. */
  tone?: "neutral" | "accent";
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  wrap = false,
  size = "md",
  tone = "neutral",
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-1 rounded-lg border border-border bg-muted/40 p-1",
        wrap ? "flex-wrap" : "",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
              wrap ? "flex-none" : "flex-1",
              size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? tone === "accent"
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
