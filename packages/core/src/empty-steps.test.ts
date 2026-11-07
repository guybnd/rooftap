import { describe, expect, it } from 'vitest';
import { emptyFirstSteps } from './empty-steps';
import type { ModuleId } from './modules';

const on = (...ids: string[]) => (id: ModuleId) => ids.includes(id);

describe('emptyFirstSteps', () => {
  it('offers a step only while the module it opens is on', () => {
    expect(emptyFirstSteps('household', on('household')).steps).toEqual([]);
    expect(emptyFirstSteps('household', on('household', 'checklists')).steps.map((s) => s.href)).toEqual(['/checklists/templates']);
  });
  it('asks Rooftap only while the Assistant is on', () => {
    expect(emptyFirstSteps('recipes', on('recipes')).ask).toBeNull();
    expect(emptyFirstSteps('recipes', on('recipes', 'assistant')).ask).toEqual(expect.any(String));
  });
  it('skips an ask whose other modules are off', () => {
    const day = new Date(2026, 10, 7);
    for (let i = 0; i < 4; i++) {
      const ask = emptyFirstSteps('groceries', on('groceries', 'assistant'), new Date(day.getTime() + i * 86_400_000)).ask;
      expect(ask).toBe('Add milk, eggs and bread to the list');
    }
  });
  it('is empty for an unknown module', () => {
    expect(emptyFirstSteps('nope', () => true)).toEqual({ steps: [], ask: null });
  });
});
