// The Settings tabs as five coloured tiles (Guy, 2026-11-08: the old
// segmented row read as a filter, and the page as drab). Each tab is its
// tile in its own hue (core SETTINGS_MENU_HUES) with its name under it; the
// open tab sits on a card with an outline in its hue.
// Web twin: apps/web/src/components/settings-tab-bar.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Blocks, CircleUser, House, Info, Plug, type LucideIcon } from 'lucide-react-native';
import { LeadingTile, Text, cn, haptics, useThemeMaterial } from '@homeup/ui';
import { SETTINGS_TABS, hueSwatch, settingsMenuHue, type SettingsTabId } from '@homeup/core';

const SETTINGS_TAB_ICONS: Record<SettingsTabId, LucideIcon> = {
  you: CircleUser,
  house: House,
  tiles: Blocks,
  connected: Plug,
  about: Info,
};

export function SettingsTabBar({ active, onChange }: { active: SettingsTabId; onChange: (id: SettingsTabId) => void }) {
  const material = useThemeMaterial();
  return (
    <View accessibilityRole="tablist" className="flex-row gap-1">
      {SETTINGS_TABS.map((tab) => {
        const on = tab.id === active;
        const hue = settingsMenuHue(tab.id);
        return (
          <Pressable
            key={tab.id}
            onPress={() => {
              if (on) return;
              haptics.select();
              onChange(tab.id);
            }}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: on }}
            className={cn(
              'min-h-[76px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl border-[1.5px] px-0.5 py-2',
              on ? 'bg-card' : 'border-transparent active:bg-card/60'
            )}
            style={on ? { borderColor: hueSwatch(hue, material.scheme).glyph, boxShadow: material.cardShadow } : undefined}
          >
            <LeadingTile hue={hue} Icon={SETTINGS_TAB_ICONS[tab.id]} size="lg" />
            <Text numberOfLines={1} className={cn('text-xs font-semibold', on ? 'text-foreground' : 'text-muted-foreground')}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
