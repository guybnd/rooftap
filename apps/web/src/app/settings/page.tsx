"use client";

import { SettingsContent } from "./settings-content";
import { globalMenus } from "./settings-registry";

export default function SettingsPage() {
  return <SettingsContent panels={globalMenus[0].panels} gateOnDataCache={false} />;
}
