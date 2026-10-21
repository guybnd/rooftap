'use client';

// Rooftap Assistant: replies that land while the person is somewhere else in
// the app, and the unread count the + wears. Both apps share this so the
// chat screen, the banner host and the tab bar agree without a store.
//
// The chat screen awaits a reply; if it has been left by then it calls
// announceAnswer() instead of rendering it, and the app's banner host shows
// "Rooftap answered" with Open (and tells the server it was seen, so no push
// follows). The unread count comes from /api/assistant/status and moves
// when an answer is announced or a conversation is opened.

import { useSyncExternalStore } from 'react';
import type { AssistantConversation, AssistantMessage } from './assistant-api';

export interface AnsweredElsewhere {
  conversation: AssistantConversation;
  reply: AssistantMessage;
}

type AnswerListener = (answer: AnsweredElsewhere) => void;
const answerListeners = new Set<AnswerListener>();

/** A reply arrived after its screen was left. Counts as unread until opened. */
export function announceAnswer(answer: AnsweredElsewhere): void {
  setAssistantUnread(unread + 1);
  for (const listener of answerListeners) listener(answer);
}

export function onAnswerElsewhere(listener: AnswerListener): () => void {
  answerListeners.add(listener);
  return () => {
    answerListeners.delete(listener);
  };
}

let unread = 0;
const unreadListeners = new Set<() => void>();

/** Conversations with a reply this person hasn't opened (status `unread`). */
export function setAssistantUnread(count: number): void {
  const next = Math.max(0, Math.floor(count));
  if (next === unread) return;
  unread = next;
  for (const listener of unreadListeners) listener();
}

export function assistantUnread(): number {
  return unread;
}

function subscribeUnread(listener: () => void): () => void {
  unreadListeners.add(listener);
  return () => {
    unreadListeners.delete(listener);
  };
}

export function useAssistantUnread(): number {
  return useSyncExternalStore(subscribeUnread, assistantUnread, assistantUnread);
}
