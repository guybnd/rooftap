'use client';

// Rooftap Assistant: a conversation's messages and composer, shared by the
// chat page (assistant/[id]/page.tsx) and the pop-up chat that grows out of
// the + (components/assistant-chat-popup.tsx). State comes from core's
// useAssistantThread. Native twin: apps/mobile/src/features/assistant/thread-body.tsx.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  arriveDelayMs,
  askGreeting,
  askStarters,
  getSectionByPath,
  mentionOptions,
  minutesLeft,
  showsBrief,
  useModules,
  type AssistantThread,
} from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { sectionIconFor } from '@/lib/section-icons';
import { useDataCache } from '@/lib/data-cache';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Composer, MessageBubble, Thinking } from './assistant-parts';
import { AssistantNotice } from './assistant-notice';
import { HelperBrief } from './helper-brief';

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

const arrive = (i: number) => ({ '--arrive-delay': `${arriveDelayMs(i)}ms` }) as CSSProperties;

/**
 * "Try asking": asks worth asking from the household's enabled modules (core
 * askStarters: plans and changes, never what Home already shows), each a row
 * that sends the ask as it is. Shared by the empty Ask sheet and the
 * Assistant space. Renders nothing when no module offers one.
 */
export function AskStarters({
  onAsk,
  disabled,
  count,
  className,
  arriveFrom = 0,
}: {
  onAsk: (text: string) => void;
  disabled: boolean;
  count?: number;
  className?: string;
  /** Where in the Arrive sequence the label starts. */
  arriveFrom?: number;
}) {
  const modules = useModules();
  const starters = useMemo(() => askStarters((id) => modules.isEnabled(id), count), [modules, count]);
  if (starters.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      <p className="ask-arrive px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground" style={arrive(arriveFrom)}>
        Try asking
      </p>
      <ListGroup className="ask-arrive" style={arrive(arriveFrom + 1)}>
        {starters.map((s) => (
          <ListItem key={s.module} asChild>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(s.text)}
              aria-label={`Ask: ${s.text}`}
              className="flex w-full items-center gap-3 text-left disabled:opacity-50"
            >
              <LeadingTile sectionId={s.module} Icon={sectionIconFor(s.module)} size="md" />
              <ListItemContent>
                <ListItemTitle>
                  <span className="text-foreground">{s.text}</span>
                </ListItemTitle>
                <ListItemMeta>{s.touches}</ListItemMeta>
              </ListItemContent>
              <ListItemTrailing>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </ListItemTrailing>
            </button>
          </ListItem>
        ))}
      </ListGroup>
    </div>
  );
}

/**
 * A new ask with nothing said yet (Hearth §13 "Ask sheet"): a greeting, then
 * asks worth asking from the household's enabled modules as a list (core
 * askStarters: plans and changes, never what Home already shows). Blocks
 * rise in one after another (Arrive); a click sends the ask as it is.
 */
function AskEmpty({ onAsk, disabled }: { onAsk: (text: string) => void; disabled: boolean }) {
  const { memberProfiles, currentUserId } = useDataCache();
  const name = currentUserId ? memberProfiles[currentUserId]?.name : null;
  return (
    <div className="space-y-3">
      <div className="ask-arrive space-y-1.5 px-0.5 pt-1" style={arrive(0)}>
        <h2 className="font-heading text-[26px] font-bold leading-tight text-foreground">{askGreeting(name)}</h2>
        <p className="text-sm leading-snug text-muted-foreground">I can plan, add and sort things across the house. I check with you before I change anything.</p>
      </div>
      <AskStarters onAsk={onAsk} disabled={disabled} className="pt-1" arriveFrom={1} />
    </div>
  );
}

/** What the chat can see behind it ("Looking at Groceries"), so "this" in an ask makes sense. */
function LookingAt({ path }: { path: string }) {
  const section = getSectionByPath(path);
  const Icon = sectionIconFor(section.id);
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-card py-1 pl-1.5 pr-2.5 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" aria-hidden />
      Looking at {section.shortLabel}
    </span>
  );
}

export function ThreadMessages({ thread, className, offline = false }: { thread: AssistantThread; className?: string; offline?: boolean }) {
  const { loading, loadError, reload, messages, sending, thinking, draft, kind, showCost, deciding, decide, send, blocked, helper } = thread;
  // A helper chat picked up after a quiet spell starts from today's brief again.
  const lastAt = messages[messages.length - 1]?.created_at;
  const briefAfter = !!helper && messages.length > 0 && !sending && !thinking && showsBrief(lastAt);
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
        kind === 'household' ? (
          <p className="px-1 py-10 text-center text-sm text-muted-foreground">
            The household chat. Talk to each other here, and tag @Rooftap when you want it to look something up or make a change.
          </p>
        ) : helper ? (
          <HelperBrief helper={helper} onAsk={(text) => void send(text)} disabled={offline || !!blocked} />
        ) : (
          <AskEmpty onAsk={(text) => void send(text)} disabled={offline || !!blocked} />
        )
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
      {briefAfter && helper && <HelperBrief helper={helper} onAsk={(text) => void send(text)} disabled={offline || !!blocked} />}
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
  band = false,
  lookingAt,
  onListening,
  className,
}: {
  thread: AssistantThread;
  offline: boolean;
  autoFocus?: boolean;
  /** Starts a new quick ask (offered when this one has closed). */
  onFresh?: () => void;
  /** The pop-up: the composer sits on its own tinted band under a hairline, and the header says how long a quick ask stays open. */
  band?: boolean;
  /** The route behind the pop-up: shown above the composer while nothing has been said. */
  lookingAt?: string;
  /** Voice input started or stopped. */
  onListening?: (on: boolean) => void;
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
    <div className={cn('flex flex-col gap-2', band && 'border-t border-border bg-muted/40 pt-2.5', className)}>
      {blocked && blocked !== 'assistant_conversation_closed' && <AssistantNotice code={blocked} />}
      {closed || blocked === 'assistant_conversation_closed' ? (
        <ClosedFooter onContinue={resume} onFresh={onFresh} />
      ) : (
        <>
          {lookingAt && !thread.messages.length && !thread.loading && <LookingAt path={lookingAt} />}
          <Composer
            placeholder={kind === 'household' ? 'Message the household, tag @Rooftap to ask it' : conversation ? 'Ask a follow-up' : 'Ask Rooftap anything'}
            disabled={offline || blocked === 'assistant_requires_plus' || (blocked === 'assistant_not_configured' && kind !== 'household')}
            busy={sending}
            autoFocus={autoFocus || thread.resumed}
            photos={thread.photos}
            mentions={mentions}
            voice
            onListening={onListening}
            onSend={send}
          />
          {!band && left != null && left > 0 && (
            <p className="px-2 text-[11px] text-muted-foreground">Takes follow-ups for {left} more min. Pin it to keep it as a chat.</p>
          )}
        </>
      )}
    </div>
  );
}
