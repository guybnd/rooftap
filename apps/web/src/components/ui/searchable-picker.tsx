"use client";

// FLUX-115: a generic searchable, categorised combobox. Replaces the bare
// <select> cost-item pickers (capture sheet + documents page) and is reusable
// for any "pick one of many" field — built so tag autocomplete and link-target
// pickers (FLUX-114) can reuse it.
//
// Behaviour: a trigger button opens a popover with an autofocus search box and a
// scrollable list. With no query, the top `recentCount` options are pinned under
// a "Recent" header, then the rest are shown under their category group headers.
// Typing filters flat across primary + secondary + extra searchText. Keyboard:
// ↑/↓ move, Enter selects, Esc closes; click-outside closes; touch taps a row.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PickerOption } from "@homeup/core";

export type { PickerOption };

interface SearchablePickerProps {
  options: PickerOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Pin the top N options (in input order) under a "Recent" header when not searching. */
  recentCount?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

interface Section {
  header: { label: string; color?: string } | null;
  options: PickerOption[];
}

function matches(opt: PickerOption, q: string): boolean {
  const hay = `${opt.primary} ${opt.secondary ?? ""} ${opt.searchText ?? ""}`.toLowerCase();
  return hay.includes(q);
}

export function SearchablePicker({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  recentCount = 0,
  disabled = false,
  className,
  ariaLabel,
}: SearchablePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  // Group into display sections. Flat filtered list when searching; recents +
  // category groups when not.
  const { sections, flat } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const filtered = options.filter((o) => matches(o, q));
      return { sections: [{ header: null, options: filtered }] as Section[], flat: filtered };
    }

    const out: Section[] = [];
    let rest = options;
    if (recentCount > 0 && options.length > recentCount) {
      const recents = options.slice(0, recentCount);
      out.push({ header: { label: "Recent" }, options: recents });
      rest = options.slice(recentCount);
    }

    const grouped = new Map<string, Section>();
    const order: string[] = [];
    for (const o of rest) {
      const key = o.group?.key ?? "__none";
      if (!grouped.has(key)) {
        grouped.set(key, {
          header: o.group ? { label: o.group.label, color: o.group.color } : null,
          options: [],
        });
        order.push(key);
      }
      grouped.get(key)!.options.push(o);
    }
    for (const key of order) out.push(grouped.get(key)!);

    const flatList = out.flatMap((s) => s.options);
    return { sections: out, flat: flatList };
  }, [options, query, recentCount]);

  // Reset highlight to the selected row (or top) whenever the visible set changes.
  useEffect(() => {
    if (!open) return;
    const idx = flat.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, flat, value]);

  // Focus the search box on open.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
      setQuery("");
    },
    [onChange]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = flat[activeIndex];
        if (opt) choose(opt.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [flat, activeIndex, choose]
  );

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm outline-none focus:border-ring disabled:opacity-50"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.primary : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1" role="listbox">
            {flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              sections.map((section, si) => (
                <div key={si}>
                  {section.header && (
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {section.header.color && (
                        <span className={cn("inline-block h-2 w-2 rounded-full", section.header.color)} />
                      )}
                      {section.header.label}
                    </div>
                  )}
                  {section.options.map((opt) => {
                    const flatIdx = flat.indexOf(opt);
                    const isActive = flatIdx === activeIndex;
                    const isSelected = opt.value === value;
                    return (
                      <button
                        type="button"
                        key={opt.value}
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => choose(opt.value)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                          isActive && "bg-muted"
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{opt.primary}</span>
                          {opt.secondary && (
                            <span className="block truncate text-xs text-muted-foreground">{opt.secondary}</span>
                          )}
                        </span>
                        {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
