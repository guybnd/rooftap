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
import { EMPTY_DRAFT, applyStreamEvent, type AssistantDraft } from './assistant-stream';
import { isConversationOpen, wantsAssistantReply, type ConversationKind } from './assistant';
import { deviceKeyValue } from './data/store-environment';

interface CachedThread {
  conversation: AssistantConversation;
  messages: AssistantMessage[];
}

const THREAD_CACHE_SIZE = 12;
/** How often an open household thread checks for what other members wrote. */
export const HOUSEHOLD_POLL_MS = 6_000;
const threadCache = new Map<string, CachedThread>();

// The cache is also kept on the device (the app's key-value store), so a
// conversation already read opens at once after the app was closed, from a
// notification or the list, while the network catches up. Only entries
// under a conversation id are kept, never the `household` alias, so another
// account signing in on the same device can't land on this one's threads;
// clearThreadCache() empties it on sign-out.
const DEVICE_KEY = 'rooftap.assistant.threads';
/** Messages kept per thread on the device; the screen refreshes the rest. */
const DEVICE_MESSAGES = 40;
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function hydrate(): void {
  const store = deviceKeyValue();
  if (hydrated || !store) return;
  hydrated = true;
  try {
    const raw = store.getItem(DEVICE_KEY);
    const entries = raw ? (JSON.parse(raw) as CachedThread[]) : [];
    for (const entry of entries) {
      if (entry?.conversation?.id && Array.isArray(entry.messages) && !threadCache.has(entry.conversation.id)) {
        threadCache.set(entry.conversation.id, entry);
      }
    }
  } catch {
    // A cache that can't be read is just empty.
  }
}

function saveSoon(): void {
  const store = deviceKeyValue();
  if (!store || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const seen = new Set<string>();
    const entries: CachedThread[] = [];
    for (const [key, entry] of threadCache) {
      if (key === 'household' || seen.has(entry.conversation.id)) continue;
      seen.add(entry.conversation.id);
      entries.push({
        conversation: entry.conversation,
        messages: entry.messages.filter((m) => !m.id.startsWith('local-')).slice(-DEVICE_MESSAGES),
      });
    }
    try {
      store.setItem(DEVICE_KEY, JSON.stringify(entries));
    } catch {
      // Full or unavailable storage only costs the instant reopen.
    }
  }, 400);
}

/** Keeps a thread for instant reopening, under its id (and `household` for the shared one). */
export function rememberThread(conversation: AssistantConversation, messages: AssistantMessage[]): void {
  hydrate();
  const entry = { conversation, messages };
  for (const key of conversation.kind === 'household' ? [conversation.id, 'household'] : [conversation.id]) {
    threadCache.delete(key);
    threadCache.set(key, entry);
  }
  while (threadCache.size > THREAD_CACHE_SIZE) threadCache.delete(threadCache.keys().next().value as string);
  saveSoon();
}

export function cachedThread(id: string): CachedThread | null {
  hydrate();
  return threadCache.get(id) ?? null;
}

export function forgetThread(id: string): void {
  hydrate();
  threadCache.delete(id);
  saveSoon();
}

/** Empties the cache, here and on the device (sign-out, switching servers). */
export function clearThreadCache(): void {
  threadCache.clear();
  hydrated = true;
  try {
    deviceKeyValue()?.setItem(DEVICE_KEY, '[]');
  } catch {
    // Nothing to clear.
  }
}

/** Recent conversations from the cache, newest first: what the pop-up's chat list shows before the network answers. */
export function cachedConversations(): AssistantConversation[] {
  hydrate();
  const seen = new Map<string, AssistantConversation>();
  for (const entry of threadCache.values()) seen.set(entry.conversation.id, entry.conversation);
  return [...seen.values()].sort((a, b) => b.last_active_at.localeCompare(a.last_active_at));
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
    mine: true,
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
  // Waiting on Rooftap's answer (the dots); a household message that doesn't tag it just sends.
  const [thinking, setThinking] = useState(false);
  // The reply as it is written (HOUP-509): what Rooftap is doing, then the text so far.
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const sendingRef = useRef(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<AssistantErrorCode | null>(null);
  // Why the last load failed (offline, timed out), offered with Try again.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCost, setShowCost] = useState(false);
  // A closed quick ask the person chose to carry on: the next send reopens it.
  const [resumed, setResumed] = useState(false);
  const resumedRef = useRef(false);
  const hostRef = useRef(host);
  hostRef.current = host;
  const shownCount = useRef(messages.length);
  shownCount.current = messages.length;

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

  // The same surface moved on to a new conversation (the chat page's Start fresh): drop the old one.
  const shownTarget = useRef(target.id);
  useEffect(() => {
    if (shownTarget.current !== target.id && target.id === 'new') {
      conversationIdRef.current = null;
      resumedRef.current = false;
      setConversation(null);
      setMessages([]);
      setBlocked(null);
      setResumed(false);
    }
    shownTarget.current = target.id;
  }, [target.id]);

  /** Re-reads the thread (opening it marks it read on the server, so the + dot may go). */
  const reload = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const { api } = hostRef.current;
    let id: string | undefined = conversationIdRef.current ?? (isNew ? undefined : target.id);
    if (!id) {
      setLoading(false);
      return;
    }
    if (!quiet) setLoadError(null);
    // A retry with nothing on screen shows the skeleton again; a refresh under messages doesn't.
    if (!quiet && shownCount.current === 0) setLoading(true);
    try {
      if (id === 'household') id = (await api.conversations()).find((c) => c.kind === 'household')?.id;
      if (id) {
        const res = await api.messages(id);
        // A message going out meanwhile would vanish from the list; the send brings it back with the rest.
        if (quiet && sendingRef.current) return;
        rememberThread(res.conversation, res.messages);
        setConversation(res.conversation);
        setMessages(res.messages);
      }
    } catch (err) {
      if (quiet) return;
      if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
      else setLoadError(errorText(err, 'Could not load this conversation.'));
    } finally {
      setLoading(false);
    }
    if (!quiet) refreshUnread();
  }, [isNew, target.id, refreshUnread]);

  useEffect(() => {
    void reload();
    hostRef.current.api
      .settings()
      .then((s) => setShowCost(s.settings.showCostPerReply))
      .catch(() => {});
  }, [reload]);

  // The household thread is a chat room: while it is on screen, what other members write shows up.
  const householdId = kind === 'household' ? conversation?.id ?? null : null;
  useEffect(() => {
    if (!householdId) return;
    const timer = setInterval(() => {
      if (hostRef.current.presence() === 'here') void reload({ quiet: true });
    }, HOUSEHOLD_POLL_MS);
    return () => clearInterval(timer);
  }, [householdId, reload]);

  const send = useCallback(
    async (text: string) => {
      const { api, toast } = hostRef.current;
      const local = pendingMessage(text);
      setMessages((m) => [...m, local]);
      setSending(true);
      sendingRef.current = true;
      setThinking(wantsAssistantReply(kind, 'app', text));
      try {
        const res = await api.send({ text, conversationId: conversationIdRef.current, kind, reopen: resumedRef.current || undefined }, (event) =>
          setDraft((d) => applyStreamEvent(d ?? EMPTY_DRAFT, event))
        );
        resumedRef.current = false;
        setResumed(false);
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
        sendingRef.current = false;
        setThinking(false);
        setDraft(null);
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

  /** Carries on a closed quick ask: the composer comes back, and the next message reopens it with its history. */
  const resume = useCallback(() => {
    resumedRef.current = true;
    setResumed(true);
    setBlocked((b) => (b === 'assistant_conversation_closed' ? null : b));
  }, []);
  // Closed: a quick ask past its idle time, unless the person chose to carry on.
  const closed = !!conversation && !resumed && !isConversationOpen(conversation.kind, conversation.closes_at);

  return { conversation, messages, kind, loading, loadError, sending, thinking, draft, deciding, blocked, showCost, closed, resumed, send, decide, togglePin, remove, reload, resume };
}

export type AssistantThread = ReturnType<typeof useAssistantThread>;
