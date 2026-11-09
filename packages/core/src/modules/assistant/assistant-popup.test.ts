import { describe, expect, it, vi } from 'vitest';
import { assistantConversationFromUrl, onAssistantPopup, openAssistantPopup, snapBubble, bubbleMenuBelow, bubbleMenuChoices } from './assistant-popup';

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

describe('snapBubble', () => {
  it('snaps to the nearer side and keeps the lift in range', () => {
    expect(snapBubble(100, 400, 50, 300)).toEqual({ side: 'left', lift: 50 });
    expect(snapBubble(300, 400, -20, 300)).toEqual({ side: 'right', lift: 0 });
    expect(snapBubble(250, 400, 900, 300)).toEqual({ side: 'right', lift: 300 });
  });
});

describe('bubble hold menu', () => {
  it('opens below a bubble in the top half', () => {
    expect(bubbleMenuBelow({ side: 'right', lift: 0 }, 100, 56, 800)).toBe(false);
    expect(bubbleMenuBelow({ side: 'left', lift: 400 }, 100, 56, 800)).toBe(true);
  });
  it('offers every chat but the one put away', () => {
    const choices = [{ helper: null, label: 'Rooftap' }, { helper: 'costs', label: 'Money helper' }];
    expect(bubbleMenuChoices(choices, 'costs').map((c) => c.label)).toEqual(['Rooftap']);
    expect(bubbleMenuChoices(choices, null).map((c) => c.label)).toEqual(['Money helper']);
  });
});
