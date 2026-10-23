import { describe, expect, it } from 'vitest';
import type { AssistantConversation } from './assistant-api';
import { assistantSpaceCaption, conversationRowMeta, groupConversations, popupChatSections, popupTitle } from './assistant-view';

const NOW = new Date('2026-10-21T10:00:00Z');
const conv = (id: string, extra: Partial<AssistantConversation> = {}): AssistantConversation => ({
  id,
  kind: 'chat',
  title: id,
  pinned: false,
  last_active_at: '2026-10-21T09:00:00Z',
  closes_at: null,
  pending: 0,
  ...extra,
});

describe('conversationRowMeta', () => {
  it('says which one is on show, then the household audience', () => {
    expect(conversationRowMeta(conv('a'), true, NOW)).toBe('Showing now');
    expect(conversationRowMeta(null, false, NOW)).toBe('Everyone in the home');
    expect(conversationRowMeta(conv('h', { kind: 'household' }), false, NOW)).toBe('Everyone in the home');
  });

  it('gives an open quick ask its minutes left, else when it was last active', () => {
    expect(conversationRowMeta(conv('q', { kind: 'quick', closes_at: '2026-10-21T10:12:00Z' }), false, NOW)).toBe('Open for 12 min');
    expect(conversationRowMeta(conv('q', { kind: 'quick', closes_at: '2026-10-21T09:00:00Z', last_active_at: new Date().toISOString() }), false, NOW)).toBe(
      'Just now',
    );
    expect(conversationRowMeta(conv('c', { last_active_at: 'not a date' }), false, NOW)).toBeNull();
  });
});

describe('assistantSpaceCaption', () => {
  it('counts chats and adds the month’s spend when there is any', () => {
    expect(assistantSpaceCaption(1, null)).toBe('1 chat');
    expect(assistantSpaceCaption(3, { spentCents: 0 })).toBe('3 chats');
    expect(assistantSpaceCaption(2, { spentCents: 250 })).toMatch(/^2 chats · .* this month$/);
  });
});

describe('pop-up helpers', () => {
  it('puts the household thread with the chats and caps the earlier quick asks', () => {
    const earlier = Array.from({ length: 8 }, (_, i) => conv(`e${i}`, { kind: 'quick', closes_at: '2026-10-21T09:00:00Z' }));
    const groups = groupConversations([conv('h', { kind: 'household' }), conv('c1'), ...earlier], NOW);
    const sections = popupChatSections(groups);
    expect(sections.map((s) => s.label)).toEqual(['Chats', 'Earlier']);
    expect(sections[0].rows.map((c) => c.id)).toEqual(['h', 'c1']);
    expect(sections[1].rows).toHaveLength(6);
    expect(popupChatSections(groupConversations([], NOW))).toEqual([]);
  });

  it('titles the pop-up', () => {
    expect(popupTitle(true, conv('a'), 'a')).toBe('Chats');
    expect(popupTitle(false, conv('a', { title: 'Plans' }), 'a')).toBe('Plans');
    expect(popupTitle(false, null, 'new')).toBe('Ask Rooftap');
    expect(popupTitle(false, null, 'abc')).toBe('');
  });
});
