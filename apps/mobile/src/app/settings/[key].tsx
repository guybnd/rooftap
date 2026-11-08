// HOUP-84: native counterpart of apps/web's settings/[key]/page.tsx. A tab
// id or an old menu key (core settingsTabForKey) opens Settings on that tab
// (HOUP-616); an enabled section's id opens that module's settings.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Text, ScreenBackground } from '@homeup/ui';
import { getSection, getEnabledSections, settingsTabForKey, useModules } from '@homeup/core';
import { SettingsContent } from '@/features/settings/settings-content';
import { moduleSettingsTabComponents } from '@/features/settings/settings-registry';
import { SettingsHome } from '@/features/settings/settings-home';

export default function SettingsKeyScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const tab = settingsTabForKey(key);
  if (tab) return <SettingsHome initialTab={tab} />;
  return <ModuleSettingsScreen moduleKey={key ?? ''} />;
}

function ModuleSettingsScreen({ moduleKey: key }: { moduleKey: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const modules = useModules();

  const section = getSection(key);
  const sectionEnabled = section ? getEnabledSections(modules.enabled).some((s) => s.id === section.id) : false;

  const label = (sectionEnabled ? section?.label : undefined) ?? 'Settings';
  const tabs = sectionEnabled ? moduleSettingsTabComponents(key, modules.enabled) : undefined;
  const notFound = !sectionEnabled;

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
        <SettingsContent panels={[]} tabs={tabs} emptyLabel={label} />
      )}
    </ScreenBackground>
  );
}
