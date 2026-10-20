"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { apartments$, useReconnectSync } from "@homeup/core";
import { Input } from "@/components/ui/input";
import { ChevronDown, MapPin, XIcon } from "lucide-react";
import type { Apartment } from '@homeup/core';

interface ApartmentPickerProps {
  value: string | null;
  onChange: (apartmentId: string | null) => void;
  suggestedId?: string | null;
}

export function ApartmentPicker({ value, onChange, suggestedId }: ApartmentPickerProps) {
  const { group } = useDataCache();
  const apts$ = apartments$(group?.id);
  useReconnectSync(apts$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [search, open]);

  const selected = apartments.find((a) => a.id === value);
  const suggested = suggestedId ? apartments.find((a) => a.id === suggestedId) : null;

  const filtered = useMemo(() => {
    if (!search.trim()) return apartments;
    const q = search.toLowerCase();
    return apartments.filter(
      (a) =>
        a.address.toLowerCase().includes(q) ||
        (a.suburb && a.suburb.toLowerCase().includes(q))
    );
  }, [apartments, search]);

  const handleSelect = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setSearch("");
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return;
    const items = filtered;
    if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIndex >= 0 && highlightIndex < items.length) {
      e.preventDefault();
      handleSelect(items[highlightIndex].id);
    }
  }, [open, filtered, highlightIndex]);

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  return (
    <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 rounded-lg border bg-transparent px-3 py-2 text-sm text-left hover:border-foreground/30 transition-colors"
      >
        {selected ? (
          <>
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate">
              {selected.address}
              {selected.suburb && <span className="text-muted-foreground">, {selected.suburb}</span>}
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); handleSelect(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); handleSelect(null); } }}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <XIcon className="h-3.5 w-3.5" />
            </span>
          </>
        ) : (
          <>
            <span className="flex-1 text-muted-foreground">Select apartment...</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-md">
          <div className="p-2">
            <Input
              placeholder="Search by address or suburb..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          {suggested && !value && !search.trim() && (
            <div className="px-1 pb-1">
              <button
                type="button"
                onClick={() => handleSelect(suggested.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm bg-primary/10 hover:bg-primary/20 text-left"
              >
                <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="flex-1 truncate">
                  <span className="font-medium">{suggested.address}</span>
                  {suggested.suburb && <span className="text-muted-foreground">, {suggested.suburb}</span>}
                </span>
                <span className="text-xs text-primary">Suggested</span>
              </button>
            </div>
          )}
          <div className="max-h-48 overflow-y-auto px-1 pb-1" ref={listRef}>
            {filtered.map((apt, idx) => (
              <button
                key={apt.id}
                type="button"
                onClick={() => handleSelect(apt.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent text-left ${
                  apt.id === value ? "bg-accent" : ""
                } ${idx === highlightIndex ? "bg-accent" : ""}`}
              >
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">
                  {apt.address}
                  {apt.suburb && <span className="text-muted-foreground">, {apt.suburb}</span>}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1.5">No apartments found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function fuzzyMatchApartment(
  location: string,
  apartments: { id: string; address: string; suburb: string | null }[]
): string | null {
  if (!location.trim()) return null;
  const loc = location.toLowerCase();

  let bestId: string | null = null;
  let bestScore = 0;

  for (const apt of apartments) {
    const addr = apt.address.toLowerCase();
    const suburb = (apt.suburb || "").toLowerCase();
    const full = `${addr} ${suburb}`;

    if (loc.includes(addr) || addr.includes(loc)) {
      return apt.id;
    }

    const locWords = loc.split(/[\s,]+/).filter((w) => w.length > 2);
    const matchCount = locWords.filter((w) => full.includes(w)).length;
    const score = locWords.length > 0 ? matchCount / locWords.length : 0;

    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestId = apt.id;
    }
  }

  return bestId;
}
