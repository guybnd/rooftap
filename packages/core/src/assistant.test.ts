import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_SETTINGS,
  assistantAccess,
  checkBudget,
  costMicros,
  isConversationOpen,
  microsToCents,
  parseAssistantSettings,
  parseModelPrices,
  quickAskClosesAt,
  strictestBudget,
  toolGate,
  trustFor,
  usageMonth,
} from './assistant';

describe('trust', () => {
  it('defaults every module to ask', () => {
    expect(trustFor(null, 'household')).toBe('ask');
    expect(trustFor({ household: 'nonsense' }, 'household')).toBe('ask');
    expect(trustFor({ groceries: 'act' }, 'groceries')).toBe('act');
  });

  it('runs reads, hides writes under read, proposes under ask, runs under act', () => {
    expect(toolGate('read', 'read')).toBe('run');
    expect(toolGate('write', 'read')).toBe('hidden');
    expect(toolGate('write', 'ask')).toBe('propose');
    expect(toolGate('write', 'act')).toBe('run');
  });

  it('always asks before a delete', () => {
    expect(toolGate('write', 'act', true)).toBe('propose');
    expect(toolGate('write', 'read', true)).toBe('hidden');
  });
});

describe('conversations', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  it('closes only quick asks, once their idle window passes', () => {
    expect(isConversationOpen('chat', '2026-10-21T09:00:00Z', now)).toBe(true);
    expect(isConversationOpen('household', null, now)).toBe(true);
    expect(isConversationOpen('quick', '2026-10-21T10:05:00Z', now)).toBe(true);
    expect(isConversationOpen('quick', '2026-10-21T09:59:00Z', now)).toBe(false);
  });

  it('counts the idle window from the last message', () => {
    expect(quickAskClosesAt(now, 30).toISOString()).toBe('2026-10-21T10:30:00.000Z');
  });
});

describe('parseAssistantSettings', () => {
  it('uses the permissive defaults with no row', () => {
    expect(parseAssistantSettings(null)).toEqual(DEFAULT_ASSISTANT_SETTINGS);
    expect(DEFAULT_ASSISTANT_SETTINGS.monthlyBudgetCents).toBeNull();
    expect(DEFAULT_ASSISTANT_SETTINGS.atLimit).toBe('warn');
  });

  it('keeps valid fields and drops bad ones', () => {
    const s = parseAssistantSettings({
      trust: { household: 'act', costs: 'nope' },
      chat_model: '  ',
      quick_model: 'gemini-2.5-flash-lite',
      context_messages: 500,
      quick_ask_idle_minutes: 0,
      monthly_budget_cents: 500,
      at_limit: 'cheap',
      warn_at_percent: null,
      show_cost_per_reply: true,
    });
    expect(s.trust).toEqual({ household: 'act' });
    expect(s.chatModel).toBeNull();
    expect(s.quickModel).toBe('gemini-2.5-flash-lite');
    expect(s.contextMessages).toBe(100);
    expect(s.quickAskIdleMinutes).toBe(1);
    expect(s.monthlyBudgetCents).toBe(500);
    expect(s.atLimit).toBe('cheap');
    expect(s.warnAtPercent).toBe(80);
    expect(s.showCostPerReply).toBe(true);
  });
});

describe('assistantAccess', () => {
  it('is Plus-only on hosted and unlimited for comped households and self-host', () => {
    expect(assistantAccess('free', 'on')).toBe('none');
    expect(assistantAccess('plus', 'on')).toBe('allowance');
    expect(assistantAccess('exempt', 'on')).toBe('unlimited');
    expect(assistantAccess('free', 'off')).toBe('unlimited');
  });
});

describe('budgets', () => {
  it('never limits without a budget', () => {
    expect(checkBudget(10_000, null, 'stop', 80)).toEqual({ status: 'ok', action: 'proceed' });
  });

  it('warns at the threshold and applies the at-limit choice when over', () => {
    expect(checkBudget(399, 500, 'stop', 80).status).toBe('ok');
    expect(checkBudget(400, 500, 'stop', 80)).toEqual({ status: 'warn', action: 'proceed' });
    expect(checkBudget(500, 500, 'warn', 80)).toEqual({ status: 'over', action: 'proceed' });
    expect(checkBudget(500, 500, 'cheap', 80)).toEqual({ status: 'over', action: 'cheap' });
    expect(checkBudget(500, 500, 'stop', 80)).toEqual({ status: 'over', action: 'stop' });
  });

  it('takes the strictest of several checks', () => {
    expect(
      strictestBudget({ status: 'warn', action: 'proceed' }, { status: 'over', action: 'cheap' }, { status: 'ok', action: 'proceed' })
    ).toEqual({ status: 'over', action: 'cheap' });
    expect(strictestBudget()).toEqual({ status: 'ok', action: 'proceed' });
  });

  it('buckets usage by UTC month', () => {
    expect(usageMonth(new Date('2026-10-31T23:59:00Z'))).toBe('2026-10-01');
  });
});

describe('prices', () => {
  it('turns tokens into micro-dollars, matching vendor-prefixed ids', () => {
    expect(costMicros('gemini-2.5-flash-lite', 4000, 300)).toBe(520);
    expect(costMicros('google/gemini-2.5-flash-lite', 4000, 300)).toBe(520);
    expect(costMicros('mystery-model', 1, 1)).toBeNull();
    expect(microsToCents(520)).toBe(1);
  });

  it('parses operator price overrides and skips bad entries', () => {
    expect(parseModelPrices('qwen3:14b=0/0, x=1/2 ,bad=, y=-1/2')).toEqual({
      'qwen3:14b': { input: 0, output: 0 },
      x: { input: 1, output: 2 },
    });
  });
});
