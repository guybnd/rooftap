// HOUP-443: one Assistant conversation. `new` starts a quick ask or chat (an
// ask from the list or the + sheet arrives as ?ask= and is sent at once),
// `household` opens the shared thread, anything else is a conversation id.
// Replies render core's Markdown subset; changes under "Ask first" arrive as
// proposal cards with one primary action (PC).
// Web twin: apps/web/src/app/assistant/[id]/page.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react-native';
import { Text, ScreenBackground, toast } from '@homeup/ui';
import {
  AssistantApiError,
  conversationTitle,
  isConversationOpen,
  minutesLeft,
  type AssistantConversation,
  type AssistantErrorCode,
  type AssistantMessage,
  type ConversationKind,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/features/assistant/assistant-api';
import { Composer, MessageBubble, Thinking } from '@/features/assistant/assistant-parts';
import { AssistantNotice } from '@/features/assistant/assistant-notice';

function pendingMessage(text: string): AssistantMessage {
  return {
    id: `local-${Date.now()}`,
    role: 'user',
    content: text,
    author: null,
    channel: 'app',
    created_at: new Date().toISOString(),
    proposal: null,
    cost_micros: null,
  };
}

export default function AssistantThreadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; kind?: string; ask?: string }>();
  const { isOnline } = useDataCache();
  const isNew = params.id === 'new';
  const newKind: ConversationKind = params.kind === 'chat' ? 'chat' : 'quick';

  const [conversation, setConversation] = React.useState<AssistantConversation | null>(null);
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [loading, setLoading] = React.useState(!isNew);
  const [sending, setSending] = React.useState(false);
  const [deciding, setDeciding] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState<AssistantErrorCode | null>(null);
  const [showCost, setShowCost] = React.useState(false);
  const scrollRef = React.useRef<ScrollView>(null);
  const sentAsk = React.useRef(false);

  const kind: ConversationKind = conversation?.kind ?? (params.id === 'household' ? 'household' : newKind);

  const load = React.useCallback(async () => {
    if (isNew) return;
    try {
      let id: string | undefined = params.id;
      if (id === 'household') id = (await assistantApi.conversations()).find((c) => c.kind === 'household')?.id;
      if (id) {
        const res = await assistantApi.messages(id);
        setConversation(res.conversation);
        setMessages(res.messages);
      }
    } catch (err) {
      if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
      else toast.error(err instanceof Error ? err.message : 'Could not load this conversation.');
    } finally {
      setLoading(false);
    }
  }, [params.id, isNew]);

  React.useEffect(() => {
    void load();
    assistantApi
      .settings()
      .then((s) => setShowCost(s.settings.showCostPerReply))
      .catch(() => {});
  }, [load]);

  const send = React.useCallback(
    async (text: string) => {
      const local = pendingMessage(text);
      setMessages((m) => [...m, local]);
      setSending(true);
      try {
        const res = await assistantApi.send({ text, conversationId: conversation?.id ?? null, kind });
        setConversation(res.conversation);
        setMessages((m) => [...m.filter((x) => x.id !== local.id), ...res.messages]);
        if (res.budget === 'warn') toast.message("The assistant is close to this month's budget.");
        return true;
      } catch (err) {
        setMessages((m) => m.filter((x) => x.id !== local.id));
        if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
        else toast.error(err instanceof Error ? err.message : 'Could not send that.');
        return false;
      } finally {
        setSending(false);
      }
    },
    [conversation?.id, kind]
  );

  // An ask handed over from the list or the + sheet goes out once.
  React.useEffect(() => {
    if (!isNew || !params.ask || sentAsk.current) return;
    sentAsk.current = true;
    void send(params.ask);
  }, [isNew, params.ask, send]);

  const decide = async (messageId: string, decision: 'confirm' | 'decline') => {
    setDeciding(messageId);
    try {
      const res = await assistantApi.decide(messageId, decision);
      setMessages((m) => [...m.map((x) => (x.id === messageId ? res.message : x)), ...(res.outcome ? [res.outcome] : [])]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not do that.');
      void load();
    } finally {
      setDeciding(null);
    }
  };

  const togglePin = async () => {
    if (!conversation) return;
    const pinned = !conversation.pinned;
    try {
      await assistantApi.updateConversation(conversation.id, { pinned });
      setConversation({
        ...conversation,
        pinned,
        kind: pinned && conversation.kind === 'quick' ? 'chat' : conversation.kind,
        closes_at: pinned ? null : conversation.closes_at,
      });
      toast.message(pinned ? (conversation.kind === 'quick' ? 'Kept as a chat.' : 'Pinned.') : 'Unpinned.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change that.');
    }
  };

  const remove = async () => {
    if (!conversation) return;
    try {
      await assistantApi.updateConversation(conversation.id, { deleted: true });
      router.back();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that.');
    }
  };

  const open = conversation ? isConversationOpen(conversation.kind, conversation.closes_at) : true;
  const left = conversation ? minutesLeft(conversation) : null;
  const title = conversation ? conversationTitle(conversation) : kind === 'household' ? 'Household' : kind === 'chat' ? 'New chat' : 'Quick ask';
  const own = !!conversation && conversation.kind !== 'household';

  return (
    <ScreenBackground>
      <KeyboardAvoidingView behavior="padding" className="flex-1" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
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
                onPress={() => void togglePin()}
                accessibilityRole="button"
                accessibilityLabel={conversation.kind === 'quick' ? 'Keep as a chat' : conversation.pinned ? 'Unpin' : 'Pin'}
                className="h-11 w-11 items-center justify-center rounded-lg"
              >
                {conversation.pinned ? <PinOff size={18} className="text-muted-foreground" /> : <Pin size={18} className="text-muted-foreground" />}
              </Pressable>
              <Pressable onPress={() => void remove()} accessibilityRole="button" accessibilityLabel="Delete conversation" className="h-11 w-11 items-center justify-center rounded-lg">
                <Trash2 size={18} className="text-muted-foreground" />
              </Pressable>
            </>
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-5 px-4 py-4"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loading ? (
            <Thinking />
          ) : messages.length === 0 && !sending ? (
            <Text className="px-1 py-10 text-center text-sm text-muted-foreground">
              {kind === 'household'
                ? 'The thread the whole household shares. Ask about the week, the list or the bills.'
                : 'Ask about tasks, the calendar, the budget or the grocery list. Rooftap asks before it changes anything.'}
            </Text>
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                showAuthor={kind === 'household'}
                showCost={showCost}
                busy={deciding === m.id}
                onDecide={(mid, d) => void decide(mid, d)}
              />
            ))
          )}
          {sending && <Thinking />}
        </ScrollView>

        <View className="gap-2 px-4 pb-3">
          {blocked && <AssistantNotice code={blocked} />}
          {!open ? (
            <AssistantNotice code="assistant_conversation_closed" />
          ) : (
            <>
              <Composer
                placeholder={kind === 'household' ? 'Message the household thread' : 'Ask a follow-up'}
                disabled={!isOnline || blocked === 'assistant_requires_plus' || blocked === 'assistant_not_configured'}
                busy={sending}
                autoFocus={isNew && !params.ask}
                onSend={send}
              />
              {left != null && left > 0 && (
                <Text className="px-2 text-[11px] text-muted-foreground">Takes follow-ups for {left} more min. Pin it to keep it as a chat.</Text>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}
