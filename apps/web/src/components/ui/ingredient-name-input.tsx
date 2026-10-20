"use client";

// FLUX-189: a single-value text input with autocomplete suggestions — the one
// genuinely net-new small widget in the recipes feature. Filter/suggest logic is
// copied from tag-input.tsx, but it holds a SINGLE free-text value (novel names
// always allowed) rather than a chip list, so typing an ingredient that already
// exists as a grocery item makes the have/need match land (reinforces decision 2).

import { useState } from "react";
import { cn } from "@/lib/utils";

interface IngredientNameInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Candidate names (grocery items + prior recipe ingredients), already deduped. */
  suggestions: string[];
  placeholder?: string;
  /** Optional per-suggestion annotation (e.g. current grocery status label). */
  annotate?: (name: string) => { label: string; className?: string } | null;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
}

export function IngredientNameInput({
  value,
  onChange,
  suggestions,
  placeholder = "Ingredient name…",
  annotate,
  ariaLabel,
  autoFocus,
  className,
}: IngredientNameInputProps) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  // While typing, filter; on focus with no query, surface the first few so the
  // autocomplete is discoverable. Never suggest an exact match to the current value.
  const matches = (
    q
      ? suggestions.filter((s) => s.toLowerCase().includes(q))
      : focused
        ? suggestions
        : []
  )
    .filter((s) => s.toLowerCase() !== q)
    .slice(0, 6);

  return (
    <div
      className={cn("relative", className)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
    >
      <input
        value={value}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring placeholder:text-muted-foreground"
      />
      {focused && matches.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="max-h-52 overflow-y-auto py-1">
            {matches.map((s) => {
              const note = annotate?.(s) ?? null;
              return (
                <button
                  key={s}
                  type="button"
                  // preventDefault keeps focus on the input (beats the blur race);
                  // onClick handles activation for mouse + keyboard.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange(s)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{s}</span>
                  {note && (
                    <span className={cn("shrink-0 text-xs", note.className ?? "text-muted-foreground")}>
                      {note.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
