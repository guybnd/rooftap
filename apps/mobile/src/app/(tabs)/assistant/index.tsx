// HOUP-443: the Assistant space. Rooftap leads with its own mark, the
// changes waiting on your OK lead as one row, the ask field sits on the list
// it starts (H5) with a couple of "Try asking" starters; then the pinned
// Household thread, your chats, open quick asks and earlier ones, each row a
// three-slot line item (H6). Web twin: apps/web/src/app/assistant/page.tsx.
import * as React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Archive, ChevronRight, Plus, WifiOff } from 'lucide-react-native';
import { Text, Button, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, ScreenBackground } from '@homeup/ui';
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
import { AskStarters } from '@/features/assistant/thread-body';
import { RooftapTile } from '@/components/brand/rooftap-mark';

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
        {/* Rooftap introduces itself with its own mark (the Ask sheet's
            avatar), and the changes waiting on your OK lead as one row. */}
        <View className="flex-row items-center gap-3">
          <RooftapTile size="md" />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-heading text-[22px] font-bold leading-tight text-foreground">
              Rooftap
            </Text>
            {!!caption && (
              <Text numberOfLines={1} className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {caption}
              </Text>
            )}
          </View>
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
        {(status?.pending ?? 0) > 0 && (
          <ListGroup>
            <ListItem className="items-center gap-3" accessibilityLabel={`${status!.pending} waiting on your OK`}>
              <View className="size-9 items-center justify-center rounded-[11px] bg-muted">
                <Text className="text-body font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {status!.pending}
                </Text>
              </View>
              <ListItemContent>
                <ListItemTitle numberOfLines={1}>{status!.pending === 1 ? 'A change waits on your OK' : 'Changes wait on your OK'}</ListItemTitle>
                <ListItemMeta>
                  <Text className="text-caption text-muted-foreground">Open the chat to approve or skip</Text>
                </ListItemMeta>
              </ListItemContent>
            </ListItem>
          </ListGroup>
        )}

        {hardBlock && blocked ? (
          <AssistantNotice code={blocked} />
        ) : (
          <>
            <Composer placeholder="Ask Rooftap anything" disabled={!isOnline} onSend={ask} />
            {error && <Text className="px-1 text-sm text-destructive">{error}</Text>}
            {blocked && <AssistantNotice code={blocked} />}
            <AskStarters onAsk={ask} disabled={!isOnline} count={2} />
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
