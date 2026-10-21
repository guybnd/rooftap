import { describe, expect, it } from 'vitest';
import { aiAccess, aiKeysUsageLine, householdAiKeysShown, aiBlockedMessage, cleanAiKey, decideAiKey, PLUS_AI_READS_PER_MONTH, type AiKeyInput } from './ai-keys';

const base: AiKeyInput = { preferred: 'gemini', householdKeys: new Set(), serverKey: true, access: 'allowance', usedThisMonth: 0 };

describe('decideAiKey (HOUP-436)', () => {
  it("uses the household's key for the preferred provider first", () => {
    expect(decideAiKey({ ...base, householdKeys: new Set(['openai', 'gemini']) })).toEqual({ source: 'household', provider: 'gemini' });
  });

  it("falls back to any household key, even with no plan", () => {
    expect(decideAiKey({ ...base, access: 'none', householdKeys: new Set(['anthropic']) })).toEqual({ source: 'household', provider: 'anthropic' });
  });

  it('blocks hosted Free with no key of its own', () => {
    expect(decideAiKey({ ...base, access: 'none' })).toEqual({ blocked: 'ai_requires_plus' });
  });

  it('uses the server key on Plus until the allowance runs out', () => {
    expect(decideAiKey({ ...base, usedThisMonth: PLUS_AI_READS_PER_MONTH - 1 })).toEqual({ source: 'server', provider: 'gemini' });
    expect(decideAiKey({ ...base, usedThisMonth: PLUS_AI_READS_PER_MONTH })).toEqual({ blocked: 'ai_allowance_used' });
  });

  it('never caps unlimited households', () => {
    expect(decideAiKey({ ...base, access: 'unlimited', usedThisMonth: 10_000 })).toEqual({ source: 'server', provider: 'gemini' });
  });

  it('says so when the server has no key', () => {
    expect(decideAiKey({ ...base, serverKey: false })).toEqual({ blocked: 'ai_not_configured' });
  });
});

describe('aiAccess', () => {
  it('matches the assistant rule: billing off or comped is unlimited, Plus has an allowance, Free has none', () => {
    expect(aiAccess('free', 'off')).toBe('unlimited');
    expect(aiAccess('exempt', 'on')).toBe('unlimited');
    expect(aiAccess('plus', 'on')).toBe('allowance');
    expect(aiAccess('free', 'on')).toBe('none');
  });
});

describe('cleanAiKey', () => {
  it('trims a pasted key and rejects things that cannot be one', () => {
    expect(cleanAiKey('  sk-abcdefghijklmnopqrstuvwxyz \n')).toBe('sk-abcdefghijklmnopqrstuvwxyz');
    expect(cleanAiKey('short')).toBeNull();
    expect(cleanAiKey('sk-abc defghijklmnopqrstuvwxyz')).toBeNull();
    expect(cleanAiKey(42)).toBeNull();
  });
});

describe('aiBlockedMessage', () => {
  it('points at Settings > AI keys and uses no em-dashes', () => {
    for (const code of ['ai_requires_plus', 'ai_allowance_used', 'ai_not_configured'] as const) {
      expect(aiBlockedMessage(code)).toContain('Settings > AI keys');
      expect(aiBlockedMessage(code)).not.toContain('—');
    }
  });
});

describe('householdAiKeysShown', () => {
  it('hides the panel when the server keys cover the household, unless a key is saved to remove', () => {
    const k = [{ provider: 'gemini' as const, last4: 'abcd', createdAt: '' }];
    expect(householdAiKeysShown({ keys: [] })).toBe(true);
    expect(householdAiKeysShown({ keys: [], serverKeysCover: true })).toBe(false);
    expect(householdAiKeysShown({ keys: k, serverKeysCover: true })).toBe(true);
  });
});

describe('aiKeysUsageLine', () => {
  it('says whose key pays', () => {
    const k = [{ provider: 'gemini' as const, last4: 'abcd', createdAt: '' }];
    expect(aiKeysUsageLine({ keys: k, access: 'none', used: 0, allowance: null })).toContain("household's key is used first");
    expect(aiKeysUsageLine({ keys: [], access: 'allowance', used: 12, allowance: 300 })).toBe("12 of 300 AI reads on Rooftap's key used this month.");
    expect(aiKeysUsageLine({ keys: [], access: 'none', used: 0, allowance: null })).toContain('Add your own key');
  });
});
