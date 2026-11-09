"use client";

// HOUP-616: Settings opens on its tabs (You, Home, Tiles, Connected, About),
// with no hub page first. Each tab is its own path (/settings, then
// /settings/<tab>), so the left column on wide screens and the tab row here
// are both plain links, and the tabs are coloured tiles (SettingsTabBar). You and Connected fold every panel to its header
// row (SettingsFold), so a tab reads as a short list.
// Native twin: apps/mobile/src/features/settings/settings-home.tsx.
import { useModules, type SettingsTabId } from "@homeup/core";
import { useDataCache } from "@/lib/data-cache";
import { SettingsFold, SettingsTint } from "@/components/settings-panel";
import { SettingsTabBar } from "@/components/settings-tab-bar";
import { settingsTabs, visiblePanels } from "./settings-registry";
import SettingsLoading from "./loading";

export function SettingsHome({ tab: tabId }: { tab: SettingsTabId }) {
  const modules = useModules();
  const { loading } = useDataCache();
  const tab = settingsTabs.find((t) => t.id === tabId) ?? settingsTabs[0];
  const panels = visiblePanels(tab.panels, modules.enabled);
  const body = panels.map((Panel, i) => <Panel key={`${tab.id}-${i}`} />);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      {/* Wide screens pick the tab in the left column (app-sidebar.tsx). */}
      <div className="space-y-4 md:hidden">
        <h1 className="px-1 font-heading text-3xl font-semibold">Settings</h1>
        <SettingsTabBar active={tab.id} />
      </div>
      {loading ? (
        <SettingsLoading />
      ) : (
        <SettingsTint>
          {tab.fold ? (
            <div className="space-y-3">
              <SettingsFold>{body}</SettingsFold>
            </div>
          ) : (
            <div className="space-y-6">{body}</div>
          )}
        </SettingsTint>
      )}
    </main>
  );
}
