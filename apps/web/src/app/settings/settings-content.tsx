"use client";

import type { ComponentType } from "react";
import { useDataCache } from "@/lib/data-cache";
import SettingsLoading from "./loading";

/**
 * Shared body for every settings tab: one loading guard (data-cache) + a panel
 * stack, or an honest empty state for a section that has no registered panels.
 * Both the Global page and the [section] page render through this so routing
 * stays dumb and the registry stays the single source of truth.
 */
export function SettingsContent({
  panels,
  emptyLabel,
  gateOnDataCache = true,
}: {
  panels: ComponentType[];
  emptyLabel?: string;
  /**
   * HOUP-50 bug 4: the Global Settings page (src/app/settings/page.tsx) opts
   * out of this gate so its panels (SectionPreferences, HomeProfileSettings,
   * NavigationSettings) paint immediately instead of waiting on the remote
   * data-cache fetch — all three are confirmed null-safe against the cache's
   * not-yet-loaded defaults and hydrate in place once it resolves. Every
   * other menu/section keeps the gate: several of their panels (group/agent/
   * store management) assume a resolved `group`/`currentUserId` and aren't
   * safe to render against the cache's loading-state defaults.
   */
  gateOnDataCache?: boolean;
}) {
  const { loading } = useDataCache();

  if (gateOnDataCache && loading) return <SettingsLoading />;

  if (panels.length === 0) {
    // H4: a plain neutral card, not a dashed box (a second border style).
    return (
      <main className="p-4 sm:p-8 max-w-3xl mx-auto">
        <div className="rounded-3xl border border-border/60 bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-[var(--card-shadow)]">
          Nothing to set for {emptyLabel ?? "this section"} yet
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
      {panels.map((Panel, i) => (
        <Panel key={i} />
      ))}
    </main>
  );
}
