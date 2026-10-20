// HOUP-138: global offline indicator, mounted once in the root layout — the
// mobile-scoped counterpart of apps/web/src/components/offline-indicator.tsx.
// Native has no Legend-State sync-outbox visibility yet (that's web's
// pending-count/"Synced" half — see apps/web/src/lib/legend/sync-status.tsx;
// HOUP-70's native sync engine doesn't exist yet), so this is deliberately
// narrower: it only reflects useDataCache().isOnline. Copy reuses web's
// shared "Requires connection" phrase (apps/web/src/components/offline-hint.tsx's
// OFFLINE_REASON) so the wording matches wherever a Rooftap surface explains
// why something needs a connection.
// HOUP-160: absolutely positioned so it overlays instead of reflowing the
// Stack below it — screens already pad their own insets.top, so an in-flow
// banner stacked its insets.top+8 on top of that (double gap) and caused a
// layout jump whenever connectivity toggled.
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
    <View
      className="absolute left-0 right-0 top-0 z-20 flex-row items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 pb-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <WifiOff size={14} className="shrink-0 text-warning" />
      <Text className="flex-1 text-caption text-warning">Offline: requires connection to sync</Text>
    </View>
  );
}
