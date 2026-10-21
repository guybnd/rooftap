'use client';

// Rooftap Assistant: one conversation's state and actions, shared by every
// surface that shows a thread (the full screen on web and native, and the
// pop-up chat that grows out of the +). Each platform passes its own API
// client, toasts and "can the person see this right now" check.
//
// Threads opened recently stay in memory, so reopening one (from the +, a
// notification or the list) paints at once and refreshes behind, instead of
// a blank screen waiting on the network.

import { useCallback, useEffect, useRef, useState } from 'react';
import { announceAnswer, setAssistantUnread, type AnsweredElsewhere } from './assistant-answers';
import {
  AssistantApiError,
  type AssistantApi,
  type AssistantConversation,
  type AssistantErrorCode,
  type AssistantMessage,
} from './assistant-api';
import type { ConversationKind } from './assistant';

interface CachedThread {
  conversation: AssistantConversation;
  messages: AssistantMessage[];
}

const THREAD_CACHE_SIZE = 12;
const threadCache = new Map<string, CachedThread>();

/** Keeps a thread for instant reopening, under its id (and `household` for the shared one). */
export function rememberThread(conversation: AssistantConversation, messages: AssistantMessage[]): void {
  const entry = { conversation, messages };
  for (const key of conversation.kind === 'household' ? [conversation.id, 'household'] : [conversation.id]) {
    threadCache.delete(key);
    threadCache.set(key, entry);
  }
  while (threadCache.size > THREAD_CACHE_SIZE) threadCache.delete(threadCache.keys().next().value as string);
}

export function cachedThread(id: string): CachedThread | null {
  return threadCache.get(id) ?? null;
}

export function forgetThread(id: string): void {
  threadCache.delete(id);
}

/** Which conversation: an id, `household`, or `new` (with the kind to start). */
export interface ThreadTarget {
  id: string;
  kind?: ConversationKind;
}

/**
 * Where the person is when a reply lands: looking at it, away in another
 * app (the push covers it), or elsewhere in this app (the surface's
 * `onAway` tells them; by default the "Rooftap answered" banner).
 */
export type ThreadPresence = 'here' | 'background' | 'away';

export interface ThreadHost {
  api: AssistantApi;
  presence: () => ThreadPresence;
  onAway?: (answer: AnsweredElsewhere) => void;
  toast: { error: (message: string) => void; message: (message: string) => void };
}

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

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useAssistantThread(target: ThreadTarget, host: ThreadHost) {
  const isNew = target.id === 'new';
  const cached = isNew ? null : cachedThread(target.id);
  const [conversation, setConversation] = useState<AssistantConversation | null>(cached?.conversation ?? null);
  const [messages, setMessages] = useState<AssistantMessage[]>(cached?.messages ?? []);
  // Only a thread with nothing to show yet waits; a cached one refreshes behind.
  const [loading, setLoading] = useState(!isNew && !cached);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<AssistantErrorCode | null>(null);
  const [showCost, setShowCost] = useState(false);
  const hostRef = useRef(host);
  hostRef.current = host;

  const newKind: ConversationKind = target.kind === 'chat' ? 'chat' : 'quick';
  const kind: ConversationKind = conversation?.kind ?? (target.id === 'household' ? 'household' : newKind);

  const refreshUnread = useCallback(() => {
    void hostRef.current.api
      .status()
      .then((s) => setAssistantUnread(s.unread ?? 0))
      .catch(() => {});
  }, []);

  const conversationIdRef = useRef<string | null>(cached?.conversation.id ?? null);
  conversationIdRef.current = conversation?.id ?? conversationIdRef.current;

  /** Re-reads the thread (opening it marks it read on the server, so the + dot may go). */
  const reload = useCallback(async () => {
    const { api, toast } = hostRef.current;
    let id: string | undefined = conversationIdRef.current ?? (isNew ? undefined : target.id);
    if (!id) return;
    try {
      if (id === 'household') id = (await api.conversations()).find((c) => c.kind === 'household')?.id;
      if (id) {
        const res = await api.messages(id);
        rememberThread(res.conversation, res.messages);
        setConversation(res.conversation);
        setMessages(res.messages);
      }
    } catch (err) {
      if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
      else toast.error(errorText(err, 'Could not load this conversation.'));
    } finally {
      setLoading(false);
    }
    refreshUnread();
  }, [isNew, target.id, refreshUnread]);

  useEffect(() => {
    void reload();
    hostRef.current.api
      .settings()
      .then((s) => setShowCost(s.settings.showCostPerReply))
      .catch(() => {});
  }, [reload]);

  const send = useCallback(
    async (text: string) => {
      const { api, toast } = hostRef.current;
      const local = pendingMessage(text);
      setMessages((m) => [...m, local]);
      setSending(true);
      try {
        const res = await api.send({ text, conversationId: conversationIdRef.current, kind });
        const reply = res.messages.filter((m) => m.role === 'assistant').pop();
        conversationIdRef.current = res.conversation.id;
        setConversation(res.conversation);
        setMessages((m) => {
          const next = [...m.filter((x) => x.id !== local.id), ...res.messages];
          rememberThread(res.conversation, next);
          return next;
        });
        const presence = hostRef.current.presence();
        // In view with the app in front is read; in the background the push covers it.
        if (presence === 'here') void api.markRead(res.conversation.id).catch(() => {});
        else if (presence === 'away' && reply) (hostRef.current.onAway ?? announceAnswer)({ conversation: res.conversation, reply });
        if (presence === 'here') {
          if (res.budget === 'warn') toast.message("The assistant is close to this month's budget.");
          else if (res.budget === 'over') toast.message("The assistant is over this month's budget.");
        }
        return true;
      } catch (err) {
        setMessages((m) => m.filter((x) => x.id !== local.id));
        if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
        else toast.error(errorText(err, 'Could not send that.'));
        return false;
      } finally {
        setSending(false);
      }
    },
    [kind]
  );

  const decide = useCallback(
    async (messageId: string, decision: 'confirm' | 'decline') => {
      const { api, toast } = hostRef.current;
      setDeciding(messageId);
      try {
        const res = await api.decide(messageId, decision);
        setMessages((m) => [...m.map((x) => (x.id === messageId ? res.message : x)), ...(res.outcome ? [res.outcome] : [])]);
      } catch (err) {
        toast.error(errorText(err, 'Could not do that.'));
        void reload();
      } finally {
        setDeciding(null);
      }
    },
    [reload]
  );

  const togglePin = useCallback(async () => {
    const { api, toast } = hostRef.current;
    if (!conversation) return;
    const pinned = !conversation.pinned;
    try {
      await api.updateConversation(conversation.id, { pinned });
      setConversation({
        ...conversation,
        pinned,
        kind: pinned && conversation.kind === 'quick' ? 'chat' : conversation.kind,
        closes_at: pinned ? null : conversation.closes_at,
      });
      toast.message(pinned ? (conversation.kind === 'quick' ? 'Kept as a chat.' : 'Pinned.') : 'Unpinned.');
    } catch (err) {
      toast.error(errorText(err, 'Could not change that.'));
    }
  }, [conversation]);

  /** Deletes this conversation; true once it is gone. */
  const remove = useCallback(async () => {
    const { api, toast } = hostRef.current;
    if (!conversation) return false;
    try {
      await api.updateConversation(conversation.id, { deleted: true });
      forgetThread(conversation.id);
      return true;
    } catch (err) {
      toast.error(errorText(err, 'Could not delete that.'));
      return false;
    }
  }, [conversation]);

  return { conversation, messages, kind, loading, sending, deciding, blocked, showCost, send, decide, togglePin, remove, reload };
}

export type AssistantThread = ReturnType<typeof useAssistantThread>;
