import { describe, expect, it, vi } from 'vitest';
import { assistantConversationFromUrl, onAssistantPopup, openAssistantPopup } from './assistant-popup';

describe('assistant popup', () => {
  it('opens only with a host listening', () => {
    expect(openAssistantPopup()).toBe(false);
    const host = vi.fn();
    const stop = onAssistantPopup(host);
    expect(openAssistantPopup({ ask: 'Who cooks tonight?' })).toBe(true);
    expect(host).toHaveBeenCalledWith({ ask: 'Who cooks tonight?' });
    stop();
    expect(openAssistantPopup()).toBe(false);
  });

  it('reads the conversation out of a push link', () => {
    expect(assistantConversationFromUrl('/assistant/c1')).toBe('c1');
    expect(assistantConversationFromUrl('/assistant/c1?x=1')).toBe('c1');
    expect(assistantConversationFromUrl('/assistant/new')).toBeNull();
    expect(assistantConversationFromUrl('/assistant')).toBeNull();
    expect(assistantConversationFromUrl('/tasks?focus=1')).toBeNull();
  });
});
