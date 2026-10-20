// HOUP-178: global banner for a genuine fetchGroupData() query failure
// (membership lookup, group auto-create, or the member-profiles RPC) —
// mirrors OfflineBanner's placement/shape but for useDataCache().error
// instead of isOnline, with a Retry action since (unlike offline) the fix is
// a network call, not waiting for connectivity to return.
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle } from 'lucide-react-native';
import { Text, Button } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';

export function DataErrorBanner() {
  const { error, isOnline, refresh } = useDataCache();
  const insets = useSafeAreaInsets();
  // Offline already has its own banner; don't stack two for the same root cause.
  if (!error || !isOnline) return null;

  return (
    <View
      className="absolute left-0 right-0 top-0 z-20 flex-row items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 pb-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <AlertTriangle size={14} className="shrink-0 text-destructive" />
      <Text className="flex-1 text-caption text-destructive" numberOfLines={1}>
        Couldn&apos;t load your household
      </Text>
      <Button variant="link" size="xs" textClassName="text-destructive" onPress={() => refresh()}>
        Retry
      </Button>
    </View>
  );
}
