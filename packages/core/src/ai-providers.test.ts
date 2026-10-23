import { describe, expect, it } from 'vitest';
import {
  AI_CATALOG,
  allAiModels,
  cleanAiServerSettings,
  customProviderId,
  householdAiModels,
  offeredAiModels,
  parseModelRef,
  aiModelPriceLine,
  EMPTY_AI_SERVER_SETTINGS,
  withCustomProvider,
  withCustomProviderStream,
} from './ai-providers';
import { MODEL_PRICES } from './modules/assistant/assistant';

describe('model refs', () => {
  it('split at the first colon, so model ids keep theirs', () => {
    expect(parseModelRef('custom-ollama:llama3.1:8b')).toEqual({ provider: 'custom-ollama', model: 'llama3.1:8b' });
    expect(parseModelRef('openrouter:google/gemini-3.1-flash-lite')).toEqual({ provider: 'openrouter', model: 'google/gemini-3.1-flash-lite' });
  });

  it("aren't older bare model names", () => {
    expect(parseModelRef('gemini-3.1-flash-lite')).toBeNull();
    expect(parseModelRef('ollama/llama3.1:8b')).toBeNull();
    expect(parseModelRef('')).toBeNull();
  });
});

describe('cleanAiServerSettings', () => {
  it('keeps valid entries and drops broken ones', () => {
    const s = cleanAiServerSettings({
      custom: [
        { id: 'custom-ollama', label: 'Ollama', baseURL: 'http://ollama:11434/v1/' },
        { id: 'gemini', label: 'Not mine', baseURL: 'https://x.test' },
        { id: 'custom-bad', label: 'Bad', baseURL: 'ftp://nope' },
      ],
      extraModels: [
        { provider: 'custom-ollama', id: 'qwen3:14b', input: 0, output: 0 },
        { provider: 'gemini', id: 'gemini-3.1-flash-lite' },
        { provider: 'nobody', id: 'x' },
      ],
      offered: ['anthropic:claude-haiku-5-5', 'nobody:x', 'bare-model'],
      defaults: { chat: 'custom-ollama:qwen3:14b', reads: 'broken' },
    });
    expect(s.custom).toEqual([{ id: 'custom-ollama', label: 'Ollama', baseURL: 'http://ollama:11434/v1' }]);
    expect(s.extraModels).toEqual([{ provider: 'custom-ollama', id: 'qwen3:14b', input: 0, output: 0 }]);
    expect(s.offered).toEqual(['anthropic:claude-haiku-5-5']);
    expect(s.defaults).toEqual({ chat: 'custom-ollama:qwen3:14b' });
  });

  it('reads stored JSON and survives junk', () => {
    expect(cleanAiServerSettings('{"offered":null}').offered).toBeNull();
    expect(cleanAiServerSettings('not json')).toEqual({ custom: [], extraModels: [], offered: null, defaults: {} });
  });
});

describe('which models households see', () => {
  const settings = cleanAiServerSettings({ offered: ['gemini:gemini-3.1-flash-lite', 'anthropic:claude-haiku-5-5'] });

  it('only offered models the server has a key for', () => {
    expect(offeredAiModels(settings, new Set(['gemini'])).map((m) => m.ref)).toEqual(['gemini:gemini-3.1-flash-lite']);
  });

  it('every model with a key when nothing is restricted', () => {
    const all = offeredAiModels(cleanAiServerSettings({}), new Set(['openai']));
    expect(all.map((m) => m.provider)).toEqual(AI_CATALOG.openai.models.map(() => 'openai'));
  });

  it("adds every verified model on the household's own key", () => {
    const refs = householdAiModels(settings, new Set(['gemini']), new Set(['anthropic']), 'chat').map((m) => m.ref);
    expect(refs).toContain('gemini:gemini-3.1-flash-lite');
    expect(refs).toContain('anthropic:claude-sonnet-4-6');
    expect(refs).not.toContain('gemini:gemini-2.5-flash');
  });

  it('keeps AI reads to models that can do them', () => {
    const refs = householdAiModels(settings, new Set(['gemini']), new Set(['anthropic']), 'reads').map((m) => m.ref);
    expect(refs).toContain('anthropic:claude-haiku-5-5');
    const custom = cleanAiServerSettings({ ...settings, extraModels: [{ provider: 'anthropic', id: 'claude-next' }], offered: null });
    expect(householdAiModels(custom, new Set(['anthropic']), new Set(), 'reads').map((m) => m.ref)).not.toContain('anthropic:claude-next');
    expect(refs).toContain('anthropic:claude-haiku-4-5-20251001');
  });
});

describe('the catalog', () => {
  it("prices every verified model for the assistant's budgets", () => {
    for (const m of allAiModels(cleanAiServerSettings({})).filter((x) => x.verified)) expect(MODEL_PRICES[m.model]).toBeDefined();
  });

  it("lists each provider's defaults among its models", () => {
    for (const p of Object.values(AI_CATALOG)) {
      for (const id of Object.values(p.defaults)) expect(p.models.some((m) => m.id === id)).toBe(true);
      expect(p.models.find((m) => m.id === p.defaults.reads)?.reads).toBe(true);
    }
  });

  it('writes prices without em-dashes', () => {
    expect(aiModelPriceLine({ input: 0.1, output: 0.5, verified: true })).toBe('$0.10 in, $0.50 out per million tokens');
    expect(aiModelPriceLine({ input: 3, output: 15, verified: true })).toBe('$3 in, $15 out per million tokens');
    expect(aiModelPriceLine({ input: null, output: null, verified: false })).not.toMatch(/—/);
  });

  it('makes custom provider ids that never clash', () => {
    expect(customProviderId('Home Ollama')).toBe('custom-home-ollama');
    expect(customProviderId('Home Ollama', ['custom-home-ollama'])).toBe('custom-home-ollama-2');
  });
});

describe('editing the settings', () => {
  it('adds and removes a custom provider with its models and picks', async () => {
    const { withCustomProvider, withoutCustomProvider, withDefault } = await import('./ai-providers');
    let s = cleanAiServerSettings({ offered: ['gemini:gemini-3.1-flash-lite'] });
    s = withCustomProvider(s, 'Ollama', 'http://ollama:11434/v1', ['qwen3:14b']);
    expect(s.offered).toContain('custom-ollama:qwen3:14b');
    s = withDefault(s, 'chat', 'custom-ollama:qwen3:14b');
    expect(cleanAiServerSettings(s)).toEqual(s);
    s = withoutCustomProvider(s, 'custom-ollama');
    expect(s).toEqual(cleanAiServerSettings({ offered: ['gemini:gemini-3.1-flash-lite'] }));
  });

  it('keeps what households had when the list becomes restricted', async () => {
    const { withOfferedAll } = await import('./ai-providers');
    const ready = offeredAiModels(cleanAiServerSettings({}), new Set(['gemini']));
    expect(withOfferedAll(cleanAiServerSettings({}), false, ready).offered).toEqual(ready.map((m) => m.ref));
  });
});

describe('custom provider streaming (HOUP-509)', () => {
  it('keeps a switched-off provider off, and turns it back on', () => {
    const added = withCustomProvider(EMPTY_AI_SERVER_SETTINGS, 'Home Ollama', 'http://ollama:11434/v1', ['qwen3:14b']);
    const id = added.custom[0].id;
    const off = cleanAiServerSettings(JSON.stringify(withCustomProviderStream(added, id, false)));
    expect(off.custom[0].stream).toBe(false);
    expect(withCustomProviderStream(off, id, true).custom[0]).not.toHaveProperty('stream');
    expect(cleanAiServerSettings({ ...added, custom: [{ ...added.custom[0], stream: 'yes' }] }).custom[0]).not.toHaveProperty('stream');
  });
});
