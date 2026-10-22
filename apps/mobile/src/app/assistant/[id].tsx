// HOUP-443: one Assistant conversation. `new` starts a quick ask or chat (an
// ask from the list or the + sheet arrives as ?ask= and is sent at once),
// `household` opens the shared thread, anything else is a conversation id.
// Replies render core's Markdown subset; changes under "Ask first" arrive as
// proposal cards with one primary action (PC).
// Web twin: apps/web/src/app/assistant/[id]/page.tsx.
import * as React from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, ArchiveRestore, ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react-native';
import { Text, ScreenBackground, toast } from '@homeup/ui';
import { archiveConversation, conversationTitle, deleteConversation, unarchiveConversation, useAssistantThread, useModules } from '@homeup/core';
import { archiveToast } from '@/lib/archive-toast';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/features/assistant/assistant-api';
import { ThreadFooter, ThreadMessages } from '@/features/assistant/thread-body';

const screenToast = { error: (m: string) => toast.error(m), message: (m: string) => toast.message(m) };

export default function AssistantThreadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; kind?: string; ask?: string }>();
  const { isOnline } = useDataCache();
  const isNew = params.id === 'new';
  // A reply that lands after this screen was left goes to the banner host instead.
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const thread = useAssistantThread(
    { id: params.id, kind: params.kind === 'chat' ? 'chat' : 'quick' },
    {
      api: assistantApi,
      presence: () => (!mounted.current ? 'away' : AppState.currentState === 'active' ? 'here' : 'background'),
      toast: screenToast,
    }
  );
  const { conversation, kind, send } = thread;

  // An ask handed over from the list or the + sheet goes out once.
  const sentAsk = React.useRef(false);
  React.useEffect(() => {
    if (!isNew || !params.ask || sentAsk.current) return;
    sentAsk.current = true;
    void send(params.ask);
  }, [isNew, params.ask, send]);

  // Coming back to the app with this chat open reads what landed meanwhile.
  const conversationId = conversation?.id;
  React.useEffect(() => {
    if (!conversationId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void assistantApi.markRead(conversationId).catch(() => {});
    });
    return () => sub.remove();
  }, [conversationId]);

  const title = conversation ? conversationTitle(conversation) : kind === 'household' ? 'Household' : kind === 'chat' ? 'New chat' : isNew ? 'Quick ask' : '';
  const own = !!conversation && conversation.kind !== 'household';
  const canArchive = useModules().server('assistant.archive');
  const leave = (gone: boolean) => gone && router.back();

  return (
    <ScreenBackground>
      {/* The tab bar below already clears the bottom inset. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-1 px-4 pt-2">
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" className="-ml-2 h-11 w-11 items-center justify-center rounded-lg">
            <ArrowLeft size={20} className="text-muted-foreground" />
          </Pressable>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-micro-label uppercase text-muted-foreground">
            {title}
          </Text>
          {own && (
            <>
              <Pressable
                onPress={() => void thread.togglePin()}
                accessibilityRole="button"
                accessibilityLabel={conversation.kind === 'quick' ? 'Keep as a chat' : conversation.pinned ? 'Unpin' : 'Pin'}
                className="h-11 w-11 items-center justify-center rounded-lg"
              >
                {conversation.pinned ? <PinOff size={18} className="text-muted-foreground" /> : <Pin size={18} className="text-muted-foreground" />}
              </Pressable>
              {canArchive && (
                <Pressable
                  onPress={() =>
                    void (conversation.archived
                      ? unarchiveConversation(assistantApi, conversation, archiveToast).then(() => thread.reload({ quiet: true }))
                      : archiveConversation(assistantApi, conversation, archiveToast).then(leave))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={conversation.archived ? 'Move back to chats' : 'Archive'}
                  className="h-11 w-11 items-center justify-center rounded-lg"
                >
                  {conversation.archived ? <ArchiveRestore size={18} className="text-muted-foreground" /> : <Archive size={18} className="text-muted-foreground" />}
                </Pressable>
              )}
              <Pressable
                onPress={() => void (canArchive ? deleteConversation(assistantApi, conversation, archiveToast) : thread.remove()).then(leave)}
                accessibilityRole="button"
                accessibilityLabel="Delete conversation"
                className="h-11 w-11 items-center justify-center rounded-lg"
              >
                <Trash2 size={18} className="text-muted-foreground" />
              </Pressable>
            </>
          )}
        </View>

        <ThreadMessages thread={thread} />
        <ThreadFooter thread={thread} offline={!isOnline} autoFocus={isNew && !params.ask} onFresh={() => router.replace('/assistant/new?kind=quick')} />
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}
