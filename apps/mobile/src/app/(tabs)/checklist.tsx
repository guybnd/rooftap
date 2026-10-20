// HOUP-78: native port of apps/web/src/app/checklist/page.tsx — the legacy
// singular "Apartment Checklist" route for managing the group's shared
// apartment-SCORING checklist (distinct from the unrelated /checklists
// household-tasks section). Web is a thin wrapper (loading skeleton /
// no-group fallback / delegates straight to ChecklistPanel groupId={group.id});
// ported faithfully, just wrapped in a ScrollView/SafeAreaView per this
// app's screen-chrome convention (see apps/mobile/src/app/(tabs)/homesearch/index.tsx
// and apps/mobile/src/app/(tabs)/setup/index.tsx).
//
// HOUP-142: moved from apps/mobile/src/app/apartment/checklist.tsx (route
// "/apartment/checklist") to this top-level path so it lands at "/checklist"
// — the href packages/core/src/sections.ts's homeSearchNavItems has always
// used (matching web's own route). The mismatch made this screen unreachable
// from any nav surface; nothing else linked to the old nested path (verified
// via repo-wide search before the move).
import { ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, ScreenBackground } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { ChecklistPanel } from '@/features/homesearch/checklist-panel';

export default function ApartmentChecklistScreen() {
  const insets = useSafeAreaInsets();
  const { group, loading } = useDataCache();

  if (loading) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 96 }}
      >
        {/* Sentence case (Hearth copy rules); the panel below owns the rest. */}
        <Text className="font-heading text-display font-bold text-foreground">Apartment checklist</Text>
        <ChecklistPanel groupId={group.id} />
      </ScrollView>
    </ScreenBackground>
  );
}
