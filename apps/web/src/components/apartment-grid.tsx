"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Plus, ArrowUpDown, Search, Check } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ApartmentCard } from "@/components/apartment-card";
import { cn } from "@/lib/utils";
import type { Agent, Apartment, ApartmentAgent, ApartmentWithScore } from '@homeup/core';

export type SortOption = "newest" | "prelim" | "score" | "rent-asc" | "rent-desc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "prelim", label: "Prelim score" },
  { value: "score", label: "Checklist score" },
  { value: "rent-asc", label: "Rent (low → high)" },
  { value: "rent-desc", label: "Rent (high → low)" },
];

export function SortDropdown({ value, onChange }: { value: SortOption; onChange: (v: SortOption) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const handleKeyNav = (e: React.KeyboardEvent) => {
    const idx = SORT_OPTIONS.findIndex((o) => o.value === value);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length];
      onChange(next.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = SORT_OPTIONS[(idx - 1 + SORT_OPTIONS.length) % SORT_OPTIONS.length];
      onChange(prev.value);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const current = SORT_OPTIONS.find((o) => o.value === value)!;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-muted/40 px-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort by: ${current.label}`}
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        {current.label}
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={`sort-opt-${value}`}
          tabIndex={-1}
          onKeyDown={handleKeyNav}
          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 outline-none"
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              id={`sort-opt-${opt.value}`}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors min-h-[36px]",
                opt.value === value
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Check className={cn("h-3.5 w-3.5", opt.value === value ? "opacity-100" : "opacity-0")} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ApartmentGridProps {
  initialApartments: ApartmentWithScore[];
  agents?: Agent[];
  apartmentAgents?: ApartmentAgent[];
  commentCounts?: Record<string, number>;
  latestComments?: Record<string, { content: string; user_id: string; created_at: string }[]>;
  rentMin?: number | null;
  rentMax?: number | null;
  showMaps?: boolean;
  agentFilter?: string[];
  isFiltered?: boolean;
  /** A search / quick filter / agent filter is narrowing the list: show "N shown". */
  narrowed?: boolean;
  /** Controlled sort: the page renders `SortDropdown` in its search row (H5:
   * the control sits with the other list controls) and passes the value here. */
  sortBy?: SortOption;
  onClearFilters?: () => void;
}

export function ApartmentGrid({ initialApartments, agents, apartmentAgents, commentCounts, latestComments, rentMin, rentMax, showMaps, agentFilter, isFiltered, narrowed, sortBy: controlledSort, onClearFilters }: ApartmentGridProps) {
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const apartmentAgentMap = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const aa of apartmentAgents ?? []) {
      const agent = agentMap.get(aa.agent_id);
      if (!agent) continue;
      const list = map.get(aa.apartment_id) ?? [];
      list.push(agent);
      map.set(aa.apartment_id, list);
    }
    return map;
  }, [apartmentAgents, agentMap]);
  const [apartments, setApartments] = useState(initialApartments);
  const [localSort, setLocalSort] = useState<SortOption>("newest");
  const sortBy = controlledSort ?? localSort;

  useEffect(() => {
    setApartments(initialApartments);
  }, [initialApartments]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("apartments-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "apartments" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newApt = payload.new as Apartment;
            setApartments((prev) => [{ ...newApt, score: null }, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as Apartment;
            setApartments((prev) =>
              prev.map((a) => (a.id === updated.id ? { ...updated, score: a.score } : a))
            );
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as { id: string };
            setApartments((prev) => prev.filter((a) => a.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const sorted = useMemo(() => {
    let list = [...apartments];
    if (agentFilter?.length) {
      list = list.filter((apt) => {
        const aptAgents = apartmentAgentMap.get(apt.id);
        return aptAgents?.some((a) => agentFilter.includes(a.id));
      });
    }
    switch (sortBy) {
      case "prelim":
        return list.sort((a, b) => (b.preliminaryAvg ?? -1) - (a.preliminaryAvg ?? -1));
      case "score":
        return list.sort((a, b) => (b.score?.percentage ?? -1) - (a.score?.percentage ?? -1));
      case "rent-asc":
        return list.sort((a, b) => (a.rent_per_week ?? Infinity) - (b.rent_per_week ?? Infinity));
      case "rent-desc":
        return list.sort((a, b) => (b.rent_per_week ?? 0) - (a.rent_per_week ?? 0));
      default:
        return list;
    }
  }, [apartments, sortBy, agentFilter, apartmentAgentMap]);

  const handleDelete = (id: string) => {
    setApartments((prev) => prev.filter((a) => a.id !== id));
  };

  if (apartments.length === 0) {
    if (isFiltered) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="rounded-2xl bg-muted p-5 mb-5">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No results found</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs">
            Try adjusting your search or filters to find what you&apos;re looking for.
          </p>
          {onClearFilters && (
            <button
              onClick={onClearFilters}
              className="inline-flex items-center gap-2 rounded-xl bg-secondary px-5 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-2xl bg-primary/10 p-5 mb-5">
          <Plus className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2">No apartments yet</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs">
          Add your first apartment to start scoring and comparing options.
        </p>
        <Link
          href="/apartment/new"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
        >
          <Plus className="h-4 w-4" />
          Add apartment
        </Link>
      </div>
    );
  }

  // H1: no standing "N apartments" line (unfiltered, it restated the Hero's
  // in-play count); a count only appears while a filter narrows the list.
  return (
    <>
      {(narrowed || !controlledSort) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          {narrowed ? (
            <p className="text-sm text-muted-foreground tabular-nums">{sorted.length} shown</p>
          ) : (
            <span />
          )}
          {!controlledSort && <SortDropdown value={sortBy} onChange={setLocalSort} />}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 stagger-in">
        {sorted.map((apartment) => (
          <ApartmentCard key={apartment.id} apartment={apartment} agent={apartment.agent_id ? agentMap.get(apartment.agent_id) : null} agents={apartmentAgentMap.get(apartment.id)} commentCount={commentCounts?.[apartment.id]} latestComments={latestComments?.[apartment.id]} rentMin={rentMin} rentMax={rentMax} showMap={showMaps} onDelete={handleDelete} />
        ))}
      </div>
    </>
  );
}
