// HOUP-443: the Assistant space. The Hero counts the changes waiting on your
// OK (H1); the ask field sits on the list it starts (H5); then the pinned
// Household thread, your chats, open quick asks and earlier ones, each row a
// three-slot line item (H6). Web twin: apps/web/src/app/assistant/page.tsx.
import * as React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Archive, ChevronRight, Plus, WifiOff } from 'lucide-react-native';
import { Text, Button, HeroLede, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, ScreenBackground } from '@homeup/ui';
import {
  useAssistantSpace,
  type AssistantConversation,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { assistantApi } from '@/features/assistant/assistant-api';
import { Composer } from '@/features/assistant/assistant-parts';
import { AssistantNotice } from '@/features/assistant/assistant-notice';
import { ConversationRow } from '@/features/assistant/conversation-row';
import { ModuleSettingsButton } from '@/features/settings/module-settings-sheet';

function Group({ label, rows, open }: { label: string; rows: AssistantConversation[]; open: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <View className="gap-2">
      <Text className="px-1 text-micro-label uppercase text-muted-foreground">{label}</Text>
      <ListGroup>
        {rows.map((c) => (
          <ConversationRow key={c.id} conversation={c} onPress={() => open(c.id)} />
        ))}
      </ListGroup>
    </View>
  );
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, isOnline } = useDataCache();
  const { status, archived, blocked, error, groups, caption, hardBlock, load } = useAssistantSpace(assistantApi);
  const [refreshing, setRefreshing] = React.useState(false);

  // Tabs stay mounted, so reload whenever the screen comes back into view.
  useFocusEffect(
    React.useCallback(() => {
      if (group?.id && isOnline) void load();
    }, [group?.id, isOnline, load])
  );


  if (!group) return <NoGroupScreen />;

  const open = (id: string) => router.push(`/assistant/${id}` as Href);
  const ask = (text: string) => {
    router.push({ pathname: '/assistant/[id]', params: { id: 'new', kind: 'quick', ask: text } } as unknown as Href);
    return true;
  };


  return (
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text numberOfLines={1} className="shrink text-micro-label uppercase text-muted-foreground">
            Assistant
          </Text>
          <View className="shrink-0 flex-row items-center gap-1.5">
            {!isOnline && (
              <View className="flex-row items-center gap-1 pr-0.5">
                <WifiOff size={12} className="shrink-0 text-muted-foreground" />
                <Text className="text-xs text-muted-foreground">Offline</Text>
              </View>
            )}
            <ModuleSettingsButton moduleId="assistant" className="h-9 w-9" />
            <Button size="sm" onPress={() => router.push({ pathname: '/assistant/[id]', params: { id: 'new', kind: 'chat' } } as unknown as Href)}>
              <Plus size={14} className="text-primary-foreground" />
              <Text className="text-sm font-medium text-primary-foreground">New chat</Text>
            </Button>
          </View>
        </View>
        <HeroLede value={status?.pending ?? 0} label="waiting on your OK" caption={caption} />

        {hardBlock && blocked ? (
          <AssistantNotice code={blocked} />
        ) : (
          <>
            <Composer placeholder="Ask Rooftap anything" disabled={!isOnline} onSend={ask} />
            {error && <Text className="px-1 text-sm text-destructive">{error}</Text>}
            {blocked && <AssistantNotice code={blocked} />}
            <ListGroup>
              <ConversationRow conversation={groups.household} onPress={() => open('household')} />
            </ListGroup>
            <Group label="Chats" rows={groups.chats} open={open} />
            <Group label="Quick asks" rows={groups.open} open={open} />
            <Group label="Earlier" rows={groups.earlier.slice(0, 20)} open={open} />
            {archived > 0 && (
              <ListGroup>
                <ListItem onPress={() => router.push('/assistant/archived' as Href)}>
                  <View className="size-9 items-center justify-center rounded-[11px] bg-muted">
                    <Archive size={18} className="text-muted-foreground" />
                  </View>
                  <ListItemContent>
                    <ListItemTitle numberOfLines={1}>Archived</ListItemTitle>
                    <ListItemMeta>
                      <Text className="text-caption text-muted-foreground">{archived === 1 ? '1 chat' : `${archived} chats`}</Text>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </ListItemTrailing>
                </ListItem>
              </ListGroup>
            )}
          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
