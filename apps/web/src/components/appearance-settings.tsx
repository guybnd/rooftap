"use client";

import { PanelLeft, PanelTop, Palette } from "lucide-react";
import { setNavSpeed, useNavSpeed, type NavSpeed } from "@homeup/core";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { SettingsChoiceRow, SettingsInset, SettingsLabel, SettingsPanel } from "@/components/settings-panel";
import { setDesktopLayout, useDesktopLayout } from "@/lib/desktop-layout";

const NAV_SPEED_CHOICES: { id: NavSpeed; title: string; description: string }[] = [
  { id: "fast", title: "Fast", description: "Pages snap into place" },
  { id: "smooth", title: "Smooth", description: "Pages and the colour glow glide in a little slower" },
];

export function AppearanceSettings() {
  const layout = useDesktopLayout();
  const speed = useNavSpeed();
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
      {/* Hearth §8 "Navigation speed": per device, shared by the page shift, the pebble and the glow. */}
      <div className="space-y-2">
        <SettingsLabel>Animation speed</SettingsLabel>
        <SettingsInset role="radiogroup" aria-label="Animation speed">
          {NAV_SPEED_CHOICES.map((choice) => (
            <SettingsChoiceRow
              key={choice.id}
              selected={choice.id === speed}
              onSelect={() => setNavSpeed(choice.id)}
              title={choice.title}
              description={choice.description}
            />
          ))}
        </SettingsInset>
      </div>
    </SettingsPanel>
  );
}
