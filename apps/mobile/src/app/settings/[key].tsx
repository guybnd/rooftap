// HOUP-84: native counterpart of apps/web's settings/[key]/page.tsx —
// resolves `key` against either a global-menu key or an enabled app-section
// id and renders that key's panel list via SettingsContent.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Text, ScreenBackground } from '@homeup/ui';
import { getSection, getEnabledSections, useModules } from '@homeup/core';
import { SettingsContent } from '@/features/settings/settings-content';
import { globalMenus, moduleSettingsComponents, visiblePanels } from '@/features/settings/settings-registry';

export default function SettingsKeyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const modules = useModules();

  const menu = globalMenus.find((m) => m.key === key);
  const section = !menu ? getSection(key ?? '') : undefined;
  const sectionEnabled = section ? getEnabledSections(modules.enabled).some((s) => s.id === section.id) : false;

  const label = menu?.label ?? (sectionEnabled ? section?.label : undefined) ?? 'Settings';
  const panels = menu
    ? visiblePanels(menu.panels, modules.enabled)
    : sectionEnabled
      ? moduleSettingsComponents(key ?? '', modules.enabled)
      : [];
  const notFound = !menu && !sectionEnabled;

  return (
    <ScreenBackground style={{ paddingTop: insets.top }}>
      {/* M2: the back control is a full 44px target, not a 20px glyph. */}
      <View className="flex-row items-center gap-1 px-2 pb-1 pt-1">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="size-11 items-center justify-center rounded-full active:bg-accent/40"
        >
          <ArrowLeft size={20} className="text-muted-foreground" />
        </Pressable>
        <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-semibold text-foreground">
          {label}
        </Text>
      </View>
      {notFound ? (
        <View className="flex-1 items-center justify-center p-8">
          <Text className="text-body text-muted-foreground">Not found</Text>
        </View>
      ) : (
        <SettingsContent panels={panels} emptyLabel={label} />
      )}
    </ScreenBackground>
  );
}
