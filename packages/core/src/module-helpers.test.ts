import { describe, expect, it } from 'vitest';
import { helperCanShare, helperInstructions, helperPromptText, helperShared, isHouseholdThread, moduleHelper } from './module-helpers';
import { HELPER_INSTRUCTIONS_MAX, parseAssistantSettings, wantsAssistantReply } from './modules/assistant/assistant';
import { conversationTitle, groupConversations } from './modules/assistant/assistant-view';
import type { AssistantConversation } from './modules/assistant/assistant-api';

function convo(overrides: Partial<AssistantConversation>): AssistantConversation {
  return {
    id: 'c',
    kind: 'chat',
    title: null,
    pinned: false,
    last_active_at: '2026-11-08T10:00:00Z',
    closes_at: null,
    unread: false,
    pending: 0,
    ...overrides,
  } as AssistantConversation;
}

describe('shared helper chats', () => {
  it('reads helper settings from the stored row, capped and cleaned', () => {
    const s = parseAssistantSettings({ helpers: { groceries: { shared: true, instructions: `  ${'x'.repeat(600)}  ` }, other: 'junk' } });
    expect(s.helpers.groceries.shared).toBe(true);
    expect(s.helpers.groceries.instructions).toHaveLength(HELPER_INSTRUCTIONS_MAX);
    expect(s.helpers.other).toEqual({ shared: false, instructions: '' });
    expect(parseAssistantSettings(null).helpers).toEqual({});
  });

  it('shares a helper only when owners chose it and the helper allows it', () => {
    const settings = parseAssistantSettings({ helpers: { groceries: { shared: true, instructions: 'No pork.' } } });
    expect(helperCanShare(moduleHelper('groceries'))).toBe(true);
    expect(helperCanShare({ share: 'never' })).toBe(false);
    expect(helperShared(settings, 'groceries')).toBe(true);
    expect(helperShared(parseAssistantSettings(null), 'groceries')).toBe(false);
    expect(helperShared(settings, 'nope')).toBe(false);
    expect(helperInstructions(settings, 'groceries')).toBe('No pork.');
  });

  it('answers every message in a shared helper chat, but only tags in the household thread', () => {
    expect(wantsAssistantReply('household', 'app', 'hi all')).toBe(false);
    expect(wantsAssistantReply('household', 'app', 'add milk', 'groceries')).toBe(true);
  });

  it('puts sharing and the household notes after the rules in the prompt', () => {
    const helper = moduleHelper('groceries')!;
    const text = helperPromptText(helper, { reads: [], shared: true, instructions: 'We shop at Aldi.' });
    expect(text).toContain('This chat is shared');
    expect(text.indexOf("The household's own notes")).toBeGreaterThan(text.indexOf('You are the Groceries helper'));
    expect(text).toContain('never change the rules above');
    expect(text).toContain('We shop at Aldi.');
    expect(helperPromptText(helper, { reads: [] })).not.toContain('shared');
  });

  it('keeps shared helper chats apart from the Household thread', () => {
    const room = convo({ id: 'h', kind: 'household' });
    const shop = convo({ id: 's', kind: 'household', helper: 'groceries' });
    expect(isHouseholdThread(room)).toBe(true);
    expect(isHouseholdThread(shop)).toBe(false);
    const groups = groupConversations([shop, room]);
    expect(groups.household?.id).toBe('h');
    expect(groups.chats.map((c) => c.id)).toEqual(['s']);
    expect(conversationTitle(shop)).toBe('Groceries helper');
    expect(conversationTitle(room)).toBe('Household');
  });
});
