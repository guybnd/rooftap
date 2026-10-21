'use client';

// HOUP-443: one Assistant conversation. `new` starts a quick ask or chat (an
// ask from the list or the + sheet arrives as ?ask= and is sent at once),
// `household` opens the shared thread, anything else is a conversation id.
// Replies render core's Markdown subset; changes under "Ask first" arrive as
// proposal cards with one primary action (PC). Native twin:
// apps/mobile/src/app/(tabs)/assistant/[id].tsx.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react';
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
import { assistantApi } from '@/lib/assistant-client';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { Composer, MessageBubble, Thinking } from '../assistant-parts';
import { AssistantNotice } from '../assistant-notice';

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

export default function AssistantThreadPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { isOnline } = useDataCache();
  const isNew = id === 'new';
  const newKind: ConversationKind = search.get('kind') === 'chat' ? 'chat' : 'quick';

  const [conversation, setConversation] = useState<AssistantConversation | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<AssistantErrorCode | null>(null);
  const [showCost, setShowCost] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sentAsk = useRef(false);

  const kind: ConversationKind = conversation?.kind ?? (id === 'household' ? 'household' : newKind);

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      if (id === 'household') {
        const household = (await assistantApi.conversations()).find((c) => c.kind === 'household');
        if (household) {
          const res = await assistantApi.messages(household.id);
          setConversation(res.conversation);
          setMessages(res.messages);
        }
      } else {
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
  }, [id, isNew]);

  useEffect(() => {
    void load();
    assistantApi
      .settings()
      .then((s) => setShowCost(s.settings.showCostPerReply))
      .catch(() => {});
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending]);

  const send = useCallback(
    async (text: string) => {
      const local = pendingMessage(text);
      setMessages((m) => [...m, local]);
      setSending(true);
      try {
        const res = await assistantApi.send({ text, conversationId: conversation?.id ?? null, kind });
        setConversation(res.conversation);
        setMessages((m) => [...m.filter((x) => x.id !== local.id), ...res.messages]);
        if (res.budget === 'warn') toast("The assistant is close to this month's budget.");
        else if (res.budget === 'over') toast("The assistant is over this month's budget.");
        if (isNew) router.replace(`/assistant/${res.conversation.id}`, { scroll: false });
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
    [conversation?.id, kind, isNew, router]
  );

  // An ask handed over from the list or the + sheet goes out once.
  useEffect(() => {
    const ask = search.get('ask');
    if (!isNew || !ask || sentAsk.current) return;
    sentAsk.current = true;
    void send(ask);
  }, [isNew, search, send]);

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
      setConversation({ ...conversation, pinned, kind: pinned && conversation.kind === 'quick' ? 'chat' : conversation.kind, closes_at: pinned ? null : conversation.closes_at });
      toast(pinned ? (conversation.kind === 'quick' ? 'Kept as a chat.' : 'Pinned.') : 'Unpinned.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change that.');
    }
  };

  const remove = async () => {
    if (!conversation) return;
    try {
      await assistantApi.updateConversation(conversation.id, { deleted: true });
      router.replace('/assistant');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that.');
    }
  };

  const open = conversation ? isConversationOpen(conversation.kind, conversation.closes_at) : true;
  const left = conversation ? minutesLeft(conversation) : null;
  const title = conversation ? conversationTitle(conversation) : kind === 'household' ? 'Household' : kind === 'chat' ? 'New chat' : 'Quick ask';
  const own = conversation && conversation.kind !== 'household';

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-3xl flex-col p-4 md:p-6">
      <div className="flex items-center gap-1">
        <Link
          href="/assistant"
          aria-label="Back"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={navLinkClickHandler('back', router, '/assistant')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
        {own && (
          <>
            <button
              type="button"
              onClick={() => void togglePin()}
              aria-label={conversation.kind === 'quick' ? 'Keep as a chat' : conversation.pinned ? 'Unpin' : 'Pin'}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {conversation.pinned ? <PinOff className="h-4.5 w-4.5" /> : <Pin className="h-4.5 w-4.5" />}
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              aria-label="Delete conversation"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="h-4.5 w-4.5" />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 space-y-5 py-4">
        {loading ? (
          <Thinking />
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

      <div className="sticky bottom-20 space-y-2 md:bottom-4">
        {blocked && <AssistantNotice code={blocked} />}
        {!open ? (
          <AssistantNotice code="assistant_conversation_closed" />
        ) : (
          <>
            <Composer
              placeholder={kind === 'household' ? 'Message the household thread' : 'Ask a follow-up'}
              disabled={!isOnline || blocked === 'assistant_requires_plus' || blocked === 'assistant_not_configured'}
              busy={sending}
              autoFocus={isNew && !search.get('ask')}
              onSend={send}
            />
            {left != null && left > 0 && (
              <p className="px-2 text-[11px] text-muted-foreground">Takes follow-ups for {left} more min. Pin it to keep it as a chat.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
