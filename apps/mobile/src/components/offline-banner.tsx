// HOUP-138: global offline indicator, mounted once in the root layout. The
// counterpart of apps/web/src/components/offline-indicator.tsx. The phone has
// no sync-outbox count yet, so it only reflects useDataCache().isOnline.
// Hearth §13.13: a small chip at the top, not a band across every screen.
// The app works offline, so it says so quietly. It overlays (absolute, no
// reflow) and ignores touches, so nothing below moves or gets blocked.
import { View } from 'react-native';
import { Text } from '@homeup/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';
import { useDataCache } from '@/lib/data-cache';

export function OfflineBanner() {
  const { isOnline } = useDataCache();
  const insets = useSafeAreaInsets();
  if (isOnline) return null;

  return (
    <View pointerEvents="none" className="absolute left-0 right-0 top-0 z-20 items-center" style={{ paddingTop: insets.top + 4 }}>
      <View
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel="Offline. Changes sync when you are back online."
        className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 shadow-sm"
      >
        <WifiOff size={13} className="text-warning" />
        <Text className="text-caption font-medium text-foreground">Offline</Text>
      </View>
    </View>
  );
}
