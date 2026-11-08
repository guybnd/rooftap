'use client';

// Rooftap Assistant: the list and pop-up state both apps share. The apps
// pass their API client and decide when to load (web on mount, the phone
// when its tab comes into view), and keep their own rendering and routing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantApiError, type AssistantApi, type AssistantConversation, type AssistantErrorCode, type AssistantStatus } from './assistant-api';
import { onAssistantPopup } from './assistant-popup';
import { cachedConversations, type ThreadTarget } from './assistant-thread';
import { onConversationsChanged } from '../../archive-undo';
import { setAssistantUnread } from './assistant-answers';
import { assistantSpaceCaption, groupConversations, popupChatSections } from './assistant-view';

/**
 * The Assistant space: status, the chat list grouped into sections, the
 * archived count, and why the Assistant is blocked, if it is. `load` fetches
 * it all; an archive, delete or Undo anywhere reloads it.
 */
export function useAssistantSpace(api: AssistantApi, options: { onStatus?: (status: AssistantStatus) => void } = {}) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [conversations, setConversations] = useState<AssistantConversation[] | null>(null);
  const [archived, setArchived] = useState(0);
  const [blocked, setBlocked] = useState<AssistantErrorCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onStatus = useRef(options.onStatus);
  useEffect(() => {
    onStatus.current = options.onStatus;
  });

  const load = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      if (s.access === 'none') return setBlocked('assistant_requires_plus');
      setBlocked(s.ready ? null : 'assistant_not_configured');
      const { conversations: list, archived: archivedCount } = await api.conversationList();
      setConversations(list);
      setArchived(archivedCount);
      setAssistantUnread(list.filter((c) => c.unread).length);
      onStatus.current?.(s);
      setError(null);
    } catch (err) {
      if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
      else setError(err instanceof Error ? err.message : 'Could not load the assistant.');
    }
  }, [api]);

  useEffect(() => onConversationsChanged(() => void load()), [load]);

  const groups = useMemo(() => groupConversations(conversations ?? []), [conversations]);
  const caption = assistantSpaceCaption(groups.chats.length, status);
  /** Plus or a model is missing: the space shows the notice instead of the list. */
  const hardBlock = blocked === 'assistant_requires_plus' || blocked === 'assistant_not_configured';

  return { status, conversations, archived, blocked, error, groups, caption, hardBlock, load };
}

/** The chats this person archived, loaded while `enabled` and after any archive, delete or Undo. */
export function useArchivedConversations(api: AssistantApi, enabled: boolean) {
  const [list, setList] = useState<AssistantConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.archivedConversations());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load archived chats.');
    }
  }, [api]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  useEffect(() => onConversationsChanged(() => void load()), [load]);

  return { list, error, load };
}

/**
 * The pop-up's list of chats, in sections. Paints from the device's cache at
 * once and refreshes from the server, and again after any archive, delete or
 * Undo.
 */
export function usePopupChats(api: AssistantApi) {
  const [list, setList] = useState(() => cachedConversations());
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api
      .conversations()
      .then((rows) => {
        setList(rows);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your chats.'));
  }, [api]);
  useEffect(reload, [reload]);
  useEffect(() => onConversationsChanged(reload), [reload]);
  const sections = popupChatSections(groupConversations(list));
  return { sections, error, reload };
}

export interface AssistantPopupState {
  open: boolean;
  /** Bumped to start a different conversation (remounts the thread). */
  key: number;
  target: ThreadTarget;
  ask?: string;
  /**
   * How the minimised chat offers itself back: `pill` ("Back to chat") after
   * a tap in the chat opened an item, `bubble` for a helper chat swiped away.
   * Null once it is back up or dismissed.
   */
  back: 'pill' | 'bubble' | null;
}

/**
 * The pop-up chat's open state and which conversation it shows, driven by
 * openAssistantPopup requests while `on`. A request for the conversation on
 * show (or a plain reopen) resumes it rather than restarting.
 */
export function useAssistantPopupState(on: boolean) {
  const [state, setState] = useState<AssistantPopupState>({ open: false, key: 0, target: { id: 'new', kind: 'quick' }, back: null });
  // The conversation on show, so a request for it (or a plain reopen) resumes rather than restarts.
  const current = useRef<AssistantConversation | null>(null);
  // The last plain (not helper) conversation, for hopping back to Rooftap from a helper.
  const lastPlain = useRef<string | null>(null);

  useEffect(() => {
    if (!on) return;
    return onAssistantPopup((request) => {
      setState((prev) => {
        const shown = current.current;
        if (request.helper) {
          // The helper's chat already on show just comes back up.
          if (prev.target.helper === request.helper || (shown && shown.helper === request.helper)) return { ...prev, open: true, ask: undefined, back: null };
          current.current = null;
          return { open: true, key: prev.key + 1, target: { id: 'new', kind: 'chat', helper: request.helper }, back: null };
        }
        // Plain Rooftap: the last conversation that was not a helper's, or a new quick ask.
        const conversationId = request.conversationId ?? (request.plain && !request.ask && !request.fresh ? lastPlain.current : null);
        if (conversationId) {
          if (shown?.id === conversationId) return { ...prev, open: true, ask: undefined, back: null };
          current.current = null;
          return { open: true, key: prev.key + 1, target: { id: conversationId }, back: null };
        }
        // A quick ask that has since closed stays on show: its footer offers Continue or Start fresh.
        const onHelper = !!(prev.target.helper || shown?.helper);
        if (request.ask || request.fresh || (request.plain && onHelper)) {
          current.current = null;
          return { open: true, key: prev.key + 1, target: { id: 'new', kind: 'quick' }, ask: request.ask, back: null };
        }
        return { ...prev, open: true, back: null };
      });
    });
  }, [on]);

  /**
   * Puts the chat away. `navigate`: a tap in the chat opened an item, so a
   * "Back to chat" pill offers it back. A helper chat put away by hand leaves
   * a bubble. Anything else shrinks into the + as before.
   */
  const minimize = useCallback((reason?: 'navigate') => {
    setState((prev) => {
      if (!prev.open) return prev;
      const helper = !!(prev.target.helper || current.current?.helper);
      return { ...prev, open: false, back: reason === 'navigate' ? 'pill' : helper ? 'bubble' : null };
    });
  }, []);
  /** Drops the pill or bubble; the chat itself stays, behind the +. */
  const dismissBack = useCallback(() => setState((prev) => (prev.back ? { ...prev, back: null } : prev)), []);
  const fresh = useCallback(() => {
    current.current = null;
    setState((prev) => ({ open: true, key: prev.key + 1, target: { id: 'new', kind: 'quick' }, back: null }));
  }, []);
  const remember = useCallback((c: AssistantConversation | null) => {
    current.current = c;
    if (c && !c.helper) lastPlain.current = c.id;
  }, []);

  return { state, minimize, dismissBack, fresh, remember };
}

/**
 * The pop-up thread's lifecycle: reports the conversation on show, sends a
 * handed-over ask once, and on reopening reads what landed while it was
 * minimised (or retries a failed load).
 */
export function usePopupThreadLifecycle(input: {
  open: boolean;
  ask?: string;
  conversation: AssistantConversation | null;
  loadError: unknown;
  send: (text: string) => unknown;
  reload: () => unknown;
  onConversation: (c: AssistantConversation | null) => void;
}) {
  const { open, ask, conversation, loadError, send, reload, onConversation } = input;
  useEffect(() => onConversation(conversation), [conversation, onConversation]);

  // An ask handed over (the capture sheet's box) goes out once.
  const sentAsk = useRef(false);
  useEffect(() => {
    if (!ask || sentAsk.current) return;
    sentAsk.current = true;
    void send(ask);
  }, [ask, send]);

  // Reopening reads what landed while it was minimised (and clears the + dot), or retries a failed load.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && (conversation || loadError)) void reload();
    wasOpen.current = open;
  }, [open, conversation, loadError, reload]);
}
