// The household's archived Scout searches. Each row opens its search; swipe
// right moves it back to Shopper, swipe left deletes it with Undo.
// Web twin: apps/web/src/app/shopper/scout/archived/page.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { use$ } from '@legendapp/state/react';
import { useRouter, type Href } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { ListGroup, ScreenBackground, Text } from '@homeup/ui';
import { scoutRunLists, shopperSearches$, syncStoreNow, useReconnectSync, useScoutOverrides } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { ScoutRunRow } from '@/features/shopper/scout-run-row';

export default function ArchivedScoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group } = useDataCache();
  const searches$ = shopperSearches$(group?.id);
  useReconnectSync(searches$);
  useScoutOverrides();
  const runs = use$(() => Object.values(searches$.get() ?? {}));
  const { archived } = scoutRunLists(runs);

  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 32 }}
      >
        <View className="flex-row items-center gap-1">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" className="-ml-2 h-11 w-11 items-center justify-center rounded-lg">
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">
            Archived searches
          </Text>
        </View>
        {archived.length === 0 ? (
          <Text className="px-1 text-sm text-muted-foreground">Nothing archived. Swipe a Scout search right to archive it.</Text>
        ) : (
          <ListGroup>
            {archived.map((run) => (
              <ScoutRunRow
                key={run.id}
                run={run}
                onPress={() => router.push(`/shopper/scout/${run.id}` as Href)}
                onChanged={() => syncStoreNow(searches$)}
              />
            ))}
          </ListGroup>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
