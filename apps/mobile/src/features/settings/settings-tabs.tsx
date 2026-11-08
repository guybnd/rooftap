// A module's settings split into tabs (core moduleSettingsTabs). The tab row
// scrolls sideways when the labels don't fit, and only the picked tab's
// panels render. Settings > <module> and the module's settings sheet both
// show it. Web twin: apps/web/src/components/settings-tabs.tsx.
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { SegmentedControl } from '@homeup/ui';
import type { SettingsTabPanels } from './settings-registry';

export function SettingsTabs({ tabs, accessibilityLabel }: { tabs: SettingsTabPanels[]; accessibilityLabel?: string }) {
  const [picked, setPicked] = React.useState(tabs[0]?.label ?? '');
  const current = tabs.find((t) => t.label === picked) ?? tabs[0];
  if (!current) return null;
  if (tabs.length < 2) {
    return (
      <>
        {current.panels.map((Panel, i) => (
          <Panel key={i} />
        ))}
      </>
    );
  }
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" className="-mx-4 grow-0" contentContainerClassName="px-4">
        <SegmentedControl
          fitContent
          accessibilityLabel={accessibilityLabel ?? 'Settings tabs'}
          value={current.label}
          options={tabs.map((t) => ({ value: t.label, label: t.label }))}
          onChange={setPicked}
        />
      </ScrollView>
      <View key={current.label} className="gap-6">
        {current.panels.map((Panel, i) => (
          <Panel key={i} />
        ))}
      </View>
    </>
  );
}
