'use client';

// Rooftap Assistant: a conversation's messages and composer, shared by the
// chat page (assistant/[id]/page.tsx) and the pop-up chat that grows out of
// the + (components/assistant-chat-popup.tsx). State comes from core's
// useAssistantThread. Native twin: apps/mobile/src/features/assistant/thread-body.tsx.
import { useEffect, useMemo, useRef } from 'react';
import { mentionOptions, minutesLeft, type AssistantThread } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { Button } from '@/components/ui/button';
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

/** A load that failed (offline, timed out): why, and Try again. */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" className="h-11" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function ThreadMessages({ thread, className }: { thread: AssistantThread; className?: string }) {
  const { loading, loadError, reload, messages, sending, thinking, draft, kind, showCost, deciding, decide } = thread;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending, loading, draft?.text.length, draft?.status]);
  return (
    <div className={cn('space-y-5 py-4', className)}>
      {loadError && !loading && <LoadFailed message={loadError} onRetry={() => void reload()} />}
      {loading ? (
        <ThreadLoading />
      ) : loadError && messages.length === 0 ? null : messages.length === 0 && !sending ? (
        <p className="px-1 py-10 text-center text-sm text-muted-foreground">
          {kind === 'household'
            ? 'The household chat. Talk to each other here, and tag @Rooftap when you want it to look something up or make a change.'
            : 'Ask about tasks, the calendar, the budget, groceries, recipes or your lists. Rooftap asks before it changes anything.'}
        </p>
      ) : (
        messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            showAuthor={kind === 'household'}
            showCost={showCost}
            busy={deciding === m.id}
            onDecide={(mid, d, picks) => void decide(mid, d, picks)}
          />
        ))
      )}
      {thinking && <Thinking draft={draft} />}
      <div ref={endRef} />
    </div>
  );
}

/** A quick ask past its quiet time: carry on with its history, or start over. */
function ClosedFooter({ onContinue, onFresh }: { onContinue: () => void; onFresh?: () => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <p className="text-sm text-muted-foreground">This quick ask closed after a quiet spell. Pick it back up with everything said so far, or start over.</p>
      <div className="flex gap-2">
        <Button size="lg" className="h-11 flex-1" onClick={onContinue}>
          Continue
        </Button>
        {onFresh && (
          <Button size="lg" variant="outline" className="h-11 flex-1" onClick={onFresh}>
            Start fresh
          </Button>
        )}
      </div>
    </div>
  );
}

export function ThreadFooter({
  thread,
  offline,
  autoFocus,
  onFresh,
  className,
}: {
  thread: AssistantThread;
  offline: boolean;
  autoFocus?: boolean;
  /** Starts a new quick ask (offered when this one has closed). */
  onFresh?: () => void;
  className?: string;
}) {
  const { conversation, kind, blocked, sending, send, closed, resume } = thread;
  const left = conversation && !closed ? minutesLeft(conversation) : null;
  const { groupMembers, memberProfiles, currentUserId } = useDataCache();
  const mentions = useMemo(
    () => (kind === 'household' ? mentionOptions(groupMembers, memberProfiles, currentUserId) : undefined),
    [kind, groupMembers, memberProfiles, currentUserId]
  );
  return (
    <div className={cn('space-y-2', className)}>
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
            photos={thread.photos}
            mentions={mentions}
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
