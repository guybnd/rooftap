// Rooftap Assistant: a conversation's messages and composer, shared by the
// full chat screen (app/assistant/[id].tsx) and the pop-up chat that grows
// out of the + (chat-popup.tsx). State comes from core's useAssistantThread.
// Web twin: apps/web/src/app/assistant/thread-body.tsx.
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Text } from '@homeup/ui';
import { minutesLeft, type AssistantThread } from '@homeup/core';
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

/** A load that failed (offline, timed out): why, and Try again. */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3">
      <Text className="min-w-0 flex-1 text-sm text-muted-foreground">{message}</Text>
      <Button variant="outline" className="h-11 px-3.5" onPress={onRetry}>
        <Text className="text-sm font-medium text-foreground">Try again</Text>
      </Button>
    </View>
  );
}

export function ThreadMessages({ thread, className }: { thread: AssistantThread; className?: string }) {
  const { loading, loadError, reload, messages, sending, thinking, draft, kind, showCost, deciding, decide } = thread;
  const scrollRef = React.useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scrollRef}
      className={className ?? 'flex-1'}
      contentContainerClassName="gap-5 px-4 py-4"
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !loading })}
    >
      {loadError && !loading && <LoadFailed message={loadError} onRetry={() => void reload()} />}
      {loading ? (
        <ThreadLoading />
      ) : loadError && messages.length === 0 ? null : messages.length === 0 && !sending ? (
        <Text className="px-1 py-10 text-center text-sm text-muted-foreground">
          {kind === 'household'
            ? 'The household chat. Talk to each other here, and tag @Rooftap when you want it to look something up or make a change.'
            : 'Ask about tasks, the calendar, the budget, groceries, recipes or your lists. Rooftap asks before it changes anything.'}
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
      {thinking && <Thinking draft={draft} />}
    </ScrollView>
  );
}

/** A quick ask past its quiet time: carry on with its history, or start over. */
function ClosedFooter({ onContinue, onFresh }: { onContinue: () => void; onFresh?: () => void }) {
  return (
    <View className="gap-3 rounded-2xl border border-border/60 bg-card p-4">
      <Text className="text-sm text-muted-foreground">This quick ask closed after a quiet spell. Pick it back up with everything said so far, or start over.</Text>
      <View className="flex-row gap-2">
        <Button size="lg" className="h-11 flex-1" onPress={onContinue}>
          <Text className="text-body font-medium text-primary-foreground">Continue</Text>
        </Button>
        {onFresh && (
          <Button size="lg" variant="outline" className="h-11 flex-1" onPress={onFresh}>
            <Text className="text-body font-medium text-foreground">Start fresh</Text>
          </Button>
        )}
      </View>
    </View>
  );
}

export function ThreadFooter({
  thread,
  offline,
  autoFocus,
  onFresh,
}: {
  thread: AssistantThread;
  offline: boolean;
  autoFocus?: boolean;
  /** Starts a new quick ask (offered when this one has closed). */
  onFresh?: () => void;
}) {
  const { conversation, kind, blocked, sending, send, closed, resume } = thread;
  const left = conversation && !closed ? minutesLeft(conversation) : null;
  return (
    <View className="gap-2 px-4 pb-3">
      {blocked && blocked !== 'assistant_conversation_closed' && <AssistantNotice code={blocked} />}
      {closed || blocked === 'assistant_conversation_closed' ? (
        <ClosedFooter onContinue={resume} onFresh={onFresh} />
      ) : (
        <>
          <Composer
            placeholder={kind === 'household' ? 'Message the household, tag @Rooftap to ask it' : conversation ? 'Ask a follow-up' : 'Ask Rooftap anything'}
            disabled={offline || blocked === 'assistant_requires_plus' || (blocked === 'assistant_not_configured' && kind !== 'household')}
            busy={sending}
            autoFocus={autoFocus || thread.resumed}
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
