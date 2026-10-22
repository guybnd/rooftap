// The chats this person archived. Each row opens its chat; swipe right moves
// it back to the chats, swipe left deletes it with Undo. Talking in an
// archived chat also moves it back.
// Web twin: apps/web/src/app/assistant/archived/page.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { ListGroup, ScreenBackground, Text } from '@homeup/ui';
import { onConversationsChanged, type AssistantConversation } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/features/assistant/assistant-api';
import { ConversationRow } from '@/features/assistant/conversation-row';

export default function ArchivedChatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, isOnline } = useDataCache();
  const [list, setList] = React.useState<AssistantConversation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setList(await assistantApi.archivedConversations());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load archived chats.');
    }
  }, []);

  React.useEffect(() => {
    if (group?.id && isOnline) void load();
  }, [group?.id, isOnline, load]);
  React.useEffect(() => onConversationsChanged(() => void load()), [load]);

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
            Archived chats
          </Text>
        </View>
        {error && <Text className="px-1 text-sm text-destructive">{error}</Text>}
        {list && list.length === 0 && (
          <Text className="px-1 text-sm text-muted-foreground">Nothing archived. Swipe a chat right to archive it.</Text>
        )}
        {list && list.length > 0 && (
          <ListGroup>
            {list.map((c) => (
              <ConversationRow key={c.id} conversation={c} onPress={() => router.push(`/assistant/${c.id}` as Href)} />
            ))}
          </ListGroup>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
