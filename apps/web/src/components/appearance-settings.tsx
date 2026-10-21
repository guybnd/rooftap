"use client";

import { PanelLeft, PanelTop, Palette } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { SettingsChoiceRow, SettingsInset, SettingsLabel, SettingsPanel } from "@/components/settings-panel";
import { setDesktopLayout, useDesktopLayout } from "@/lib/desktop-layout";

export function AppearanceSettings() {
  const layout = useDesktopLayout();
  return (
    <SettingsPanel icon={Palette} title="Appearance">
      <ThemeSwitcher />
      {/* Hearth §13 "Desktop shell": per browser, and only on wide screens (phones keep the tab bar). */}
      <div className="hidden space-y-2 md:block">
        <SettingsLabel>Layout on wide screens</SettingsLabel>
        <SettingsInset role="radiogroup" aria-label="Layout on wide screens">
          <SettingsChoiceRow
            selected={layout === "top"}
            onSelect={() => setDesktopLayout("top")}
            leading={<PanelTop className="h-5 w-5" />}
            title="Top bar"
            description="Spaces across the top, pages laid out in columns"
          />
          <SettingsChoiceRow
            selected={layout === "classic"}
            onSelect={() => setDesktopLayout("classic")}
            leading={<PanelLeft className="h-5 w-5" />}
            title="Classic sidebar"
            description="Spaces in a side bar, pages in one column"
          />
        </SettingsInset>
      </div>
    </SettingsPanel>
  );
}
