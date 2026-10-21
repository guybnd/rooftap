import { describe, expect, it, vi } from 'vitest';
import type { AssistantConversation, AssistantMessage } from './assistant-api';
import { announceAnswer, assistantUnread, onAnswerElsewhere, setAssistantUnread } from './assistant-answers';

const conversation = { id: 'c1', kind: 'quick', title: 'Tacos', pinned: false, last_active_at: '', closes_at: null, pending: 0 } as AssistantConversation;
const reply = { id: 'm1', role: 'assistant', content: 'Added sour cream.' } as AssistantMessage;

describe('assistant answers', () => {
  it('tells listeners and counts the answer as unread', () => {
    setAssistantUnread(2);
    const heard = vi.fn();
    const stop = onAnswerElsewhere(heard);
    announceAnswer({ conversation, reply });
    expect(heard).toHaveBeenCalledWith({ conversation, reply });
    expect(assistantUnread()).toBe(3);
    stop();
    announceAnswer({ conversation, reply });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('never counts below zero', () => {
    setAssistantUnread(-4);
    expect(assistantUnread()).toBe(0);
  });
});
