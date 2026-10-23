import { describe, expect, it } from 'vitest';
import { applyProposalPicks, proposalChoices } from './proposal-picks';

interface Item {
  tool: string;
  module: string;
  args: Record<string, unknown>;
  summary?: string;
}

const gifts: Item = {
  tool: 'add_gift_ideas',
  module: 'occasions',
  args: { occasion_id: 'o1', ideas: [{ title: 'Cooking class' }, { title: 'Candle set', price: 40 }, { title: 'Day trip' }] },
};
const milk: Item = { tool: 'create_grocery_item', module: 'groceries', args: { name: 'Milk' }, summary: 'Add "Milk" to Groceries' };

describe('proposalChoices', () => {
  it('gives each entry of a list its own row under the change', () => {
    const rows = proposalChoices([gifts, milk]);
    expect(rows.map((r) => [r.key, r.label, r.text])).toEqual([
      ['0.0', 'Cooking class', 'Cooking class'],
      ['0.1', 'Candle set', 'Candle set'],
      ['0.2', 'Day trip', 'Day trip'],
      ['1', 'Add "Milk" to Groceries', null],
    ]);
    expect(rows[0].group).toBe('Add 3 things as gift ideas in Occasions');
    expect(rows[3].group).toBeNull();
  });

  it('keeps a one-entry list as one row', () => {
    const one = { ...gifts, args: { ideas: [{ title: 'Book' }] } };
    expect(proposalChoices([one]).map((r) => r.key)).toEqual(['0']);
  });
});

describe('applyProposalPicks', () => {
  it('drops unticked entries, renames edited ones and rewrites the summary', () => {
    const out = applyProposalPicks([gifts, milk], [{ key: '0.1', text: ' Scented candles ' }, { key: '0.2' }]);
    expect(out).toHaveLength(1);
    expect(out[0].args.ideas).toEqual([{ title: 'Scented candles', price: 40 }, { title: 'Day trip' }]);
    expect(out[0].summary).toBe('Add 2 things as gift ideas in Occasions');
    expect(out[0].args.occasion_id).toBe('o1');
  });

  it('leaves a change out when every entry is unticked, and keeps whole changes by key', () => {
    expect(applyProposalPicks([gifts, milk], [{ key: '1' }])).toEqual([milk]);
    expect(applyProposalPicks([gifts, milk], [])).toEqual([]);
  });

  it('keeps an untouched change as it was', () => {
    const picks = ['0.0', '0.1', '0.2', '1'].map((key) => ({ key }));
    const out = applyProposalPicks([gifts, milk], picks);
    expect(out[0]).toBe(gifts);
    expect(out[1]).toBe(milk);
  });
});
