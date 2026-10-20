// HOUP-84: native counterpart of apps/web's settings/settings-content.tsx —
// renders a list of zero-prop panel components in sequence. Each panel owns
// its own data (via useDataCache()/Legend stores), matching the web
// contract exactly so the same settings-registry.ts shape works on both
// platforms conceptually (the component refs themselves stay separate per
// HOUP-84 Decision 4 — core can't hold component refs).
import * as React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { EmptyState } from '@homeup/ui';
import { SlidersHorizontal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDataCache } from '@/lib/data-cache';

export interface SettingsContentProps {
  panels: React.ComponentType[];
  emptyLabel?: string;
  gateOnDataCache?: boolean;
}

export function SettingsContent({ panels, emptyLabel, gateOnDataCache = true }: SettingsContentProps) {
  const insets = useSafeAreaInsets();
  const { loading } = useDataCache();

  if (gateOnDataCache && loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (panels.length === 0) {
    // §11: the shared EmptyState, not a hand-rolled dashed box (H4).
    return (
      <View className="flex-1 items-center justify-center">
        <EmptyState
          icon={SlidersHorizontal}
          title="Nothing to set yet"
          description={`${emptyLabel ?? 'This section'} has no settings of its own.`}
        />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-6 p-4"
      // The screen header above already sits below the status bar
      // (settings/[key].tsx pads by insets.top), so only a small gap here;
      // adding insets.top again left a dead band under the header.
      contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 24 }}
    >
      {panels.map((Panel, i) => (
        <Panel key={i} />
      ))}
    </ScrollView>
  );
}
