import { describe, expect, it } from 'vitest';
import { cleanScreenPath, screenPromptText } from './assistant-screen';

describe('cleanScreenPath', () => {
  it('keeps a plain route and drops the query', () => {
    expect(cleanScreenPath('/occasions?tab=ideas')).toBe('/occasions');
  });

  it('refuses anything that is not a short absolute path', () => {
    for (const bad of [null, 5, 'occasions', 'https://evil.example/x', '/a b', `/${'x'.repeat(300)}`]) {
      expect(cleanScreenPath(bad)).toBeNull();
    }
  });
});

describe('screenPromptText', () => {
  it('names the section and the item open', () => {
    const text = screenPromptText('/costs/0b8f3c3e-1f2a-4c5d-9e8f-123456789abc')!;
    expect(text).toContain('## On their screen');
    expect(text).toContain('Costs');
    expect(text).toContain('id 0b8f3c3e-1f2a-4c5d-9e8f-123456789abc');
    expect(text).toContain('never claim to see it');
  });

  it('adds nothing for the Assistant itself or no screen', () => {
    expect(screenPromptText('/assistant/abc')).toBeNull();
    expect(screenPromptText(null)).toBeNull();
    expect(screenPromptText('/')).toBeNull();
  });
});
