"use client";

import { Palette } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { SettingsPanel } from "@/components/settings-panel";

export function AppearanceSettings() {
  return (
    <SettingsPanel icon={Palette} title="Appearance">
      <ThemeSwitcher />
    </SettingsPanel>
  );
}
