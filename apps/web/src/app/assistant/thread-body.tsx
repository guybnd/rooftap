'use client';

// Rooftap Assistant: a conversation's messages and composer, shared by the
// chat page (assistant/[id]/page.tsx) and the pop-up chat that grows out of
// the + (components/assistant-chat-popup.tsx). State comes from core's
// useAssistantThread. Native twin: apps/mobile/src/features/assistant/thread-body.tsx.
import { useEffect, useRef } from 'react';
import { isConversationOpen, minutesLeft, type AssistantThread } from '@homeup/core';
import { cn } from '@/lib/utils';
import { Composer, MessageBubble, Thinking } from './assistant-parts';
import { AssistantNotice } from './assistant-notice';

/** A thread still loading: faint lines where the conversation will be, not the thinking dots (nothing is thinking yet). */
function ThreadLoading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading the conversation">
      <div className="ml-auto h-9 w-3/5 rounded-2xl bg-muted/50" />
      <div className="space-y-2">
        <div className="h-3 w-11/12 rounded-full bg-muted/40" />
        <div className="h-3 w-4/5 rounded-full bg-muted/40" />
        <div className="h-3 w-2/5 rounded-full bg-muted/40" />
      </div>
    </div>
  );
}

export function ThreadMessages({ thread, className }: { thread: AssistantThread; className?: string }) {
  const { loading, messages, sending, kind, showCost, deciding, decide } = thread;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending, loading]);
  return (
    <div className={cn('space-y-5 py-4', className)}>
      {loading ? (
        <ThreadLoading />
      ) : messages.length === 0 && !sending ? (
        <p className="px-1 py-10 text-center text-sm text-muted-foreground">
          {kind === 'household'
            ? 'The thread the whole household shares. Ask about the week, the list or the bills.'
            : 'Ask about tasks, the calendar, the budget or the grocery list. Rooftap asks before it changes anything.'}
        </p>
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
      <div ref={endRef} />
    </div>
  );
}

export function ThreadFooter({ thread, offline, autoFocus, className }: { thread: AssistantThread; offline: boolean; autoFocus?: boolean; className?: string }) {
  const { conversation, kind, blocked, sending, send } = thread;
  const open = conversation ? isConversationOpen(conversation.kind, conversation.closes_at) : true;
  const left = conversation ? minutesLeft(conversation) : null;
  return (
    <div className={cn('space-y-2', className)}>
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
            <p className="px-2 text-[11px] text-muted-foreground">Takes follow-ups for {left} more min. Pin it to keep it as a chat.</p>
          )}
        </>
      )}
    </div>
  );
}
