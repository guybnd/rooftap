"use client";

// The Settings tabs as five coloured tiles (Guy, 2026-11-08: the old
// segmented row read as a filter, and the page as drab). Each tab is its
// tile in its own hue (core SETTINGS_MENU_HUES) with its name under it; the
// open tab sits on a card with an outline in its hue. Phone width only: wide
// screens pick the tab in the left column (app-sidebar.tsx), which shows the
// same tiles. Native twin: apps/mobile/src/features/settings/settings-tab-bar.tsx.
import Link from "next/link";
import { Blocks, CircleUser, House, Info, Plug, type LucideIcon } from "lucide-react";
import { SETTINGS_TABS, settingsMenuHue, settingsTabHref, type SettingsTabId } from "@homeup/core";
import { LeadingTile } from "@/components/ui/leading-tile";
import { cn } from "@/lib/utils";

export const SETTINGS_TAB_ICONS: Record<SettingsTabId, LucideIcon> = {
  you: CircleUser,
  house: House,
  tiles: Blocks,
  connected: Plug,
  about: Info,
};

export function SettingsTabBar({ active, className }: { active: SettingsTabId; className?: string }) {
  return (
    <nav aria-label="Settings" className={cn("grid grid-cols-5 gap-1", className)}>
      {SETTINGS_TABS.map((tab) => {
        const on = tab.id === active;
        const hue = settingsMenuHue(tab.id);
        return (
          <Link
            key={tab.id}
            href={settingsTabHref(tab.id)}
            replace
            aria-current={on ? "page" : undefined}
            data-hue={hue}
            className={cn(
              "flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] px-0.5 py-2 text-xs font-semibold transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-[var(--hue-glyph)] bg-card text-foreground shadow-[var(--card-shadow)]" : "border-transparent text-muted-foreground hover:bg-card/60"
            )}
          >
            <LeadingTile hue={hue} Icon={SETTINGS_TAB_ICONS[tab.id]} size="lg" />
            <span className="max-w-full truncate">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
