// HOUP-616: Settings opens straight on its tabs (You, Home, Tiles,
// Connected, About), with no hub page first. The tabs are five coloured
// tiles (settings-tab-bar.tsx). Each tab stacks its panels;
// You and Connected fold every panel to its header row (SettingsFold), so a
// tab reads as a short list and one panel opens at a time. A module's own
// settings stay on /settings/<module>, reached from the Tiles tab.
// Web twin: apps/web/src/app/settings/settings-home.tsx.
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SectionScreen, Text } from '@homeup/ui';
import { useModules, type SettingsTabId } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { settingsTabs, visiblePanels } from './settings-registry';
import { SettingsFold, SettingsTint } from './panels/settings-panel';
import { SettingsTabBar } from './settings-tab-bar';

export function SettingsHome({ initialTab = 'you' }: { initialTab?: SettingsTabId }) {
  const [tabId, setTabId] = React.useState<SettingsTabId>(initialTab);
  const modules = useModules();
  const { loading } = useDataCache();
  const tab = settingsTabs.find((t) => t.id === tabId) ?? settingsTabs[0];
  const panels = visiblePanels(tab.panels, modules.enabled);
  const body = panels.map((Panel, i) => <Panel key={`${tab.id}-${i}`} />);

  return (
    <SectionScreen
      lede={
        <View className="gap-4">
          <Text className="px-1 text-display font-semibold text-foreground">Settings</Text>
          <SettingsTabBar active={tab.id} onChange={setTabId} />
        </View>
      }
      bottomClearance={24}
      keyboardShouldPersistTaps="handled"
    >
      {loading ? (
        <View className="items-center py-10">
          <ActivityIndicator />
        </View>
      ) : (
        <SettingsTint>
          <View key={tab.id} className={tab.fold ? 'gap-3' : 'gap-6'}>
            {tab.fold ? <SettingsFold>{body}</SettingsFold> : body}
          </View>
        </SettingsTint>
      )}
    </SectionScreen>
  );
}
