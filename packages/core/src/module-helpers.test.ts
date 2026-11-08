import { describe, expect, it } from 'vitest';
import { HOLD_CHOICE_PX, MODULE_HELPERS, chatChoices, helperCanShare, helperForPath, helperInstructions, helperPromptText, helperShared, holdChoiceAt, holdChoices, isHouseholdThread, moduleHelper, stepChoice } from './module-helpers';
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

describe('getting in and out', () => {
  const on = () => true;

  it('finds the helper for the screen you are on', () => {
    expect(helperForPath('/groceries', on)?.id).toBe('groceries');
    expect(helperForPath('/groceries/list', on)?.id).toBe('groceries');
    expect(helperForPath('/groceriesx', on)).toBeNull();
    expect(helperForPath('/tasks', on)?.id).toBe('household');
    expect(helperForPath('/settings', on)).toBeNull();
    expect(helperForPath('/groceries', (id) => id !== 'groceries')).toBeNull();
  });

  it('lists the chats to hop between, Rooftap first', () => {
    const helpers = MODULE_HELPERS.map((h) => h.id);
    expect(helpers).toEqual(expect.arrayContaining(['groceries', 'costs', 'household', 'recipes', 'occasions']));
    expect(chatChoices(on).map((c) => c.helper)).toEqual([null, ...helpers]);
    expect(chatChoices((id) => id === 'assistant' || id === 'groceries').map((c) => c.helper)).toEqual([null, 'groceries']);
    expect(chatChoices((id) => id !== 'assistant')).toEqual([{ helper: null, label: 'Rooftap' }]);
    const choices = chatChoices(on);
    expect(stepChoice(choices, null, 1)?.helper).toBe(helpers[0]);
    expect(stepChoice(choices, helpers[helpers.length - 1], 1)?.helper).toBeNull();
    expect(stepChoice(choices, null, -1)?.helper).toBe(helpers[helpers.length - 1]);
    expect(stepChoice([{ helper: null, label: 'Rooftap' }], null, 1)).toBeNull();
  });

  it('puts the screen helper first and Ask Rooftap next to the + when holding', () => {
    const choices = holdChoices('/groceries', on);
    expect(choices[0].label).toBe('Groceries helper');
    expect(choices[choices.length - 1].label).toBe('Ask Rooftap');
    expect(choices).toHaveLength(MODULE_HELPERS.length + 1);
    expect(holdChoices('/costs', on)[0].label).toBe('Money helper');
    expect(holdChoiceAt(0, 2)).toBe(1);
    expect(holdChoiceAt(-HOLD_CHOICE_PX, 2)).toBe(0);
    expect(holdChoiceAt(-HOLD_CHOICE_PX * 5, 2)).toBe(0);
    expect(holdChoiceAt(30, 2)).toBe(1);
  });
});
