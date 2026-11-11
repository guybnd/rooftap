// HOUP-178: global indicator for a genuine fetchGroupData() query failure
// (membership lookup, group auto-create, or the member-profiles RPC). It shows
// only after data-cache's quiet retries have failed too.
// Hearth §13.13: a small chip at the top like OfflineBanner, never a band
// across the screen header, with a solid card ground so it never reads on
// top of the header text below it. When the household is already painted
// from the cache, the honest copy is "couldn't refresh", not "couldn't load".
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle } from 'lucide-react-native';
import { Text, Button } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';

export function DataErrorBanner() {
  const { error, isOnline, refresh, group } = useDataCache();
  const insets = useSafeAreaInsets();
  // Offline already has its own banner; don't stack two for the same root cause.
  if (!error || !isOnline) return null;

  const label = group ? "Couldn't refresh" : "Couldn't load your household";

  return (
    <View pointerEvents="box-none" className="absolute left-0 right-0 top-0 z-20 items-center" style={{ paddingTop: insets.top + 4 }}>
      <View
        accessibilityLiveRegion="polite"
        className="flex-row items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-3 pr-1 shadow-sm"
      >
        <AlertTriangle size={13} className="text-destructive" />
        <Text className="text-caption font-medium text-foreground" numberOfLines={1}>
          {label}
        </Text>
        <Button variant="link" size="xs" textClassName="text-primary" onPress={() => refresh()}>
          Retry
        </Button>
      </View>
    </View>
  );
}
