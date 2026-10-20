"use client";

import { CalendarDays, Eye, ClipboardCheck, SkipForward, RotateCcw, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApartmentWithScore, Appointment } from '@homeup/core';

export type QuickFilter = "all" | "has-appointment" | "to-book" | "viewed" | "needs-score" | "skipped" | "rebook";

interface DashboardStatsProps {
  apartments: ApartmentWithScore[];
  appointments: Appointment[];
  activeFilter: QuickFilter;
  onFilterChange: (filter: QuickFilter) => void;
}

// Hearth v2: the quick-filter tiles under the Home search Hero lede.
// - H1: no Total/All tile. The Hero counts the listings in play, and "all" is
//   simply the unfiltered list (tap the active tile again to clear it), so a
//   Total tile only restated the lede.
// - H2: coral marks the active (interactive) tile only; a value takes a status
//   hue only when it is a state (Rebook).
// - Empty chrome: a tile with nothing in it hides unless it is the active one.
// Mirrors apps/mobile/src/features/homesearch/dashboard-stats.tsx.
export function DashboardStats({ apartments, appointments, activeFilter, onFilterChange }: DashboardStatsProps) {
  const scheduledCount = appointments.filter((a) => a.status === "scheduled").length;
  const viewedCount = appointments.filter((a) => a.status === "viewed").length;
  const toBookCount = apartments.filter((a) => a.disposition === "to_book").length;
  const skippedCount = apartments.filter((a) => a.disposition === "skipped").length;
  const rebookCount = apartments.filter((a) => a.disposition === "rebook").length;
  const unscoredCount = apartments.filter((a) => a.score === null && a.preliminaryAvg == null).length;

  const stats: { key: QuickFilter; icon: typeof Bookmark; label: string; value: number; valueClassName?: string }[] = [
    { key: "to-book", icon: Bookmark, label: "To book", value: toBookCount },
    { key: "has-appointment", icon: CalendarDays, label: "Booked", value: scheduledCount },
    { key: "viewed", icon: Eye, label: "Visited", value: viewedCount },
    { key: "rebook", icon: RotateCcw, label: "Rebook", value: rebookCount, valueClassName: "text-warning" },
    { key: "needs-score", icon: ClipboardCheck, label: "To score", value: unscoredCount },
    { key: "skipped", icon: SkipForward, label: "Skipped", value: skippedCount },
  ];
  const visible = stats.filter((s) => s.value > 0 || s.key === activeFilter);
  if (visible.length === 0) return null;

  return (
    <div role="group" aria-label="Quick filters" className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {visible.map((stat) => {
        const active = activeFilter === stat.key;
        return (
          <button
            key={stat.key}
            type="button"
            aria-pressed={active}
            onClick={() => onFilterChange(active ? "all" : stat.key)}
            className={cn(
              "flex min-h-[52px] min-w-0 flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors active:scale-[0.97]",
              active ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "bg-muted/40 hover:bg-muted/60"
            )}
          >
            <span
              className={cn(
                "flex items-center gap-1 whitespace-nowrap text-xs font-medium",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <stat.icon className="h-3 w-3 shrink-0" />
              {stat.label}
            </span>
            <span className={cn("text-sm font-semibold tabular-nums text-foreground", stat.value > 0 && stat.valueClassName)}>
              {stat.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
