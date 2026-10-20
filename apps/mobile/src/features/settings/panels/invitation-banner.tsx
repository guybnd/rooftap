// HOUP-84: native port of apps/web/src/components/invitation-banner.tsx — a
// slim "you've been invited" banner. Mounted on
// apps/mobile/src/app/(tabs)/homesearch/index.tsx (HOUP-146), matching web's
// app/homesearch/page.tsx mount point — NOT on group-manager.tsx, which only
// renders AcceptInvitationDialog for the actual accept/decline flow.
import { Pressable, View } from 'react-native';
import { Text } from '@homeup/ui';
import { useRouter, type Href } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useDataCache } from '@/lib/data-cache';

export function InvitationBanner() {
  const { pendingInvitations } = useDataCache();
  const router = useRouter();

  if (pendingInvitations.length === 0) return null;

  const inv = pendingInvitations[0];
  const groupName = inv.group_name ?? 'a group';

  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <Mail size={16} className="shrink-0 text-primary" />
      <Text className="flex-1 text-sm text-foreground">
        You&apos;ve been invited to join <Text className="font-semibold">{groupName}</Text>
        {pendingInvitations.length > 1 && (
          <Text className="text-muted-foreground"> (+{pendingInvitations.length - 1} more)</Text>
        )}
      </Text>
      <Pressable
        onPress={() => router.push('/settings' as Href)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="View in Settings"
      >
        <Text className="shrink-0 text-xs font-medium text-primary">View in Settings</Text>
      </Pressable>
    </View>
  );
}
