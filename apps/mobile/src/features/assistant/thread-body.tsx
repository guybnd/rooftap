// Rooftap Assistant: a conversation's messages and composer, shared by the
// full chat screen (app/assistant/[id].tsx) and the pop-up chat that grows
// out of the + (chat-popup.tsx). State comes from core's useAssistantThread.
// Web twin: apps/web/src/app/assistant/thread-body.tsx.
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@homeup/ui';
import { isConversationOpen, minutesLeft, type AssistantThread } from '@homeup/core';
import { Composer, MessageBubble, Thinking } from './assistant-parts';
import { AssistantNotice } from './assistant-notice';

/** A thread still loading: faint lines where the conversation will be, not the thinking dots (nothing is thinking yet). */
function ThreadLoading() {
  return (
    <View className="gap-5" accessibilityLabel="Loading the conversation" accessibilityRole="progressbar">
      <View className="h-9 w-3/5 self-end rounded-2xl bg-muted/50" />
      <View className="gap-2">
        <View className="h-3 w-11/12 rounded-full bg-muted/40" />
        <View className="h-3 w-4/5 rounded-full bg-muted/40" />
        <View className="h-3 w-2/5 rounded-full bg-muted/40" />
      </View>
    </View>
  );
}

export function ThreadMessages({ thread, className }: { thread: AssistantThread; className?: string }) {
  const { loading, messages, sending, kind, showCost, deciding, decide } = thread;
  const scrollRef = React.useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scrollRef}
      className={className ?? 'flex-1'}
      contentContainerClassName="gap-5 px-4 py-4"
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !loading })}
    >
      {loading ? (
        <ThreadLoading />
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
  );
}

export function ThreadFooter({ thread, offline, autoFocus }: { thread: AssistantThread; offline: boolean; autoFocus?: boolean }) {
  const { conversation, kind, blocked, sending, send } = thread;
  const open = conversation ? isConversationOpen(conversation.kind, conversation.closes_at) : true;
  const left = conversation ? minutesLeft(conversation) : null;
  return (
    <View className="gap-2 px-4 pb-3">
      {blocked && <AssistantNotice code={blocked} />}
      {!open ? (
        <AssistantNotice code="assistant_conversation_closed" />
      ) : (
        <>
          <Composer
            placeholder={kind === 'household' ? 'Message the household thread' : conversation ? 'Ask a follow-up' : 'Ask Rooftap anything'}
            disabled={offline || blocked === 'assistant_requires_plus' || blocked === 'assistant_not_configured'}
            busy={sending}
            autoFocus={autoFocus}
            onSend={send}
          />
          {left != null && left > 0 && (
            <Text className="px-2 text-[11px] text-muted-foreground">Takes follow-ups for {left} more min. Pin it to keep it as a chat.</Text>
          )}
        </>
      )}
    </View>
  );
}
