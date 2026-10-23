import { describe, expect, it } from 'vitest';
import {
  detectTimers,
  formatCountdown,
  formatTimerDuration,
  instructionsFromRecipeSteps,
  methodFields,
  normalizeSteps,
  recipeSteps,
  stepRowsFromRecipe,
  stepsFromParsed,
  stepsFromRows,
  ingredientPillLabel,
} from './steps';

describe('detectTimers', () => {
  it('finds minutes and names the timer after the first verb', () => {
    expect(detectTimers('Simmer for 10 minutes, stirring.')).toEqual([{ label: 'Simmer', seconds: 600 }]);
  });
  it('takes the low end of a range', () => {
    expect(detectTimers('Bake 25-30 mins until golden')).toEqual([{ label: 'Bake', seconds: 1500 }]);
  });
  it('reads hours, halves and words', () => {
    expect(detectTimers('Rest for 1 hour 20 minutes')[0].seconds).toBe(4800);
    expect(detectTimers('Chill for half an hour')[0].seconds).toBe(1800);
    expect(detectTimers('Leave for an hour')[0].seconds).toBe(3600);
    expect(detectTimers('Proof 1½ hours')[0].seconds).toBe(5400);
  });
  it('ignores vague waits and tiny or huge numbers', () => {
    expect(detectTimers('Cook until golden')).toEqual([]);
    expect(detectTimers('Stir for 5 seconds')).toEqual([]);
    expect(detectTimers('Roll out to 3 mm')).toEqual([]);
  });
});

describe('recipeSteps', () => {
  const steps = [
    { text: 'Toast the rice.', original: 'Toast the rice well', timers: [{ label: 'Toast', seconds: 120 }], ingredientIds: ['a'] },
    { text: 'Add the stock.', timers: [], ingredientIds: [] },
  ];
  it('uses structured steps when they match the text', () => {
    const r = { instructions: 'Toast the rice.\nAdd the stock.', steps };
    expect(recipeSteps(r)[0].timers).toEqual([{ label: 'Toast', seconds: 120 }]);
    expect(recipeSteps(r)[0].original).toBe('Toast the rice well');
  });
  it('lets the text win when an older app edited it', () => {
    const r = { instructions: 'Toast the rice.\nSimmer for 18 minutes.', steps };
    const out = recipeSteps(r);
    expect(out[1].text).toBe('Simmer for 18 minutes.');
    expect(out[1].timers).toEqual([{ label: 'Simmer', seconds: 1080 }]);
    expect(out[0].timers).toEqual([]);
  });
  it('reads plain instructions with found timers', () => {
    expect(recipeSteps({ instructions: 'Boil 8 minutes\n\nDrain' })).toEqual([
      { text: 'Boil 8 minutes', timers: [{ label: 'Boil', seconds: 480 }], ingredientIds: [] },
      { text: 'Drain', timers: [], ingredientIds: [] },
    ]);
  });
  it('handles no method at all', () => {
    expect(recipeSteps({ instructions: null })).toEqual([]);
  });
});

describe('normalizeSteps', () => {
  it('drops junk and keeps strings', () => {
    expect(normalizeSteps('nope')).toBeNull();
    expect(normalizeSteps([null, '', { text: '  ' }])).toBeNull();
    expect(normalizeSteps(['Mix', { text: 'Bake', timers: [{ label: '', seconds: '600' }, { seconds: -1 }] }])).toEqual([
      { text: 'Mix', timers: [], ingredientIds: [] },
      { text: 'Bake', original: null, timers: [{ label: 'Timer', seconds: 600 }], ingredientIds: [], temp: null },
    ]);
  });
  it('flattens newlines so the text copy stays one step per line', () => {
    const s = normalizeSteps([{ text: 'Mix\nwell' }])!;
    expect(instructionsFromRecipeSteps(s)).toBe('Mix well');
  });
});

describe('form rows', () => {
  it('round-trips a recipe and drops blank rows', () => {
    const rows = stepRowsFromRecipe({ instructions: 'Boil 8 minutes' });
    expect(rows).toHaveLength(1);
    const out = stepsFromRows([...rows, { ...rows[0], key: 'x', text: '  ' }]);
    expect(out).toEqual([{ text: 'Boil 8 minutes', original: null, timers: [{ label: 'Boil', seconds: 480 }], ingredientIds: [], temp: null }]);
  });
  it('gives one empty row for a new recipe', () => {
    expect(stepRowsFromRecipe(null)).toHaveLength(1);
  });
  it('writes steps only when the server has the column', () => {
    const steps = [{ text: 'Mix', timers: [], ingredientIds: [] }];
    expect(methodFields(steps, false)).toEqual({ instructions: 'Mix' });
    expect(methodFields(steps, true)).toEqual({ instructions: 'Mix', steps });
    expect(methodFields([], true)).toEqual({ instructions: null, steps: null });
  });
});

describe('stepsFromParsed', () => {
  it('turns ingredient positions into row ids', () => {
    const ids = ['i0', 'i1'];
    const out = stepsFromParsed(
      [{ text: 'Add rice', original: 'Add the rice', timers: [], ingredients: [1, 1, 5] }],
      (i) => ids[i],
    );
    expect(out?.[0].ingredientIds).toEqual(['i1']);
    expect(out?.[0].original).toBe('Add the rice');
  });
  it('is null when the server sent nothing', () => {
    expect(stepsFromParsed(undefined, () => undefined)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats durations and countdowns', () => {
    expect(formatTimerDuration(45)).toBe('45 s');
    expect(formatTimerDuration(120)).toBe('2 min');
    expect(formatTimerDuration(3600)).toBe('1 h');
    expect(formatTimerDuration(4800)).toBe('1 h 20 min');
    expect(formatCountdown(48_000)).toBe('0:48');
    expect(formatCountdown(872_100)).toBe('14:33');
    expect(formatCountdown(3_900_000)).toBe('1:05:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
  it('labels ingredient pills with amounts', () => {
    expect(ingredientPillLabel({ name: 'arborio rice', item_name: 'rice', quantity: 320, unit: 'g' })).toBe('320 g rice');
    expect(ingredientPillLabel({ name: 'salt', item_name: null, quantity: null, unit: null })).toBe('salt');
  });
});
