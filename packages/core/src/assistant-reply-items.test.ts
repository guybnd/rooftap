import { describe, expect, it } from 'vitest';
import { itemLink, parseItemLink } from './modules/assistant/assistant-links';
import { formatMoney } from './money-format';
import { MAX_REPLY_ITEMS, replyItemRefs, replyItemRows } from './assistant-reply-items';
import type { Apartment, Checklist, ChecklistTaskItem, Recipe } from './types';
import type { ShopperWant } from './modules/shopper/shopper';

describe('parseItemLink', () => {
  it('reads each item route back', () => {
    expect(parseItemLink('/recipes/r1')).toEqual({ kind: 'recipe', id: 'r1' });
    expect(parseItemLink('/checklists/c1')).toEqual({ kind: 'checklist', id: 'c1' });
    expect(parseItemLink('/shopper/w1')).toEqual({ kind: 'watch', id: 'w1' });
    expect(parseItemLink('/shopper/scout/s1')).toEqual({ kind: 'scout', id: 's1' });
    expect(parseItemLink('/apartment/a1')).toEqual({ kind: 'listing', id: 'a1' });
    expect(parseItemLink(itemLink('recipe', 'a b'))).toEqual({ kind: 'recipe', id: 'a b' });
  });

  it('skips section links and deeper routes', () => {
    expect(parseItemLink('/recipes')).toBeNull();
    expect(parseItemLink('/shopper/scout')).toBeNull();
    expect(parseItemLink('/recipes/r1/cook')).toBeNull();
    expect(parseItemLink('/costs')).toBeNull();
    expect(parseItemLink('/recipes/%E0%A4%A')).toBeNull();
  });
});

describe('replyItemRefs', () => {
  it('lists item links once, in order, skipping Scout runs and outside links', () => {
    const text =
      'Try [Okonomiyaki](/recipes/r1) or [Slaw](/recipes/r2). Again [Okonomiyaki](/recipes/r1).\n\n' +
      'I made [Market run](/checklists/c1), see [Scout](/shopper/scout/s1) and [a shop](https://example.com/recipes/x).';
    expect(replyItemRefs(text).map((r) => `${r.kind}:${r.id}`)).toEqual(['recipe:r1', 'recipe:r2', 'checklist:c1']);
  });

  it('caps the rows', () => {
    const text = Array.from({ length: 9 }, (_, i) => `[R${i}](/recipes/r${i})`).join(' ');
    expect(replyItemRefs(text)).toHaveLength(MAX_REPLY_ITEMS);
  });

  it('returns nothing for empty text', () => {
    expect(replyItemRefs(null)).toEqual([]);
    expect(replyItemRefs('No links here.')).toEqual([]);
  });
});

describe('replyItemRows', () => {
  const recipe = (over: Partial<Recipe>) => ({ id: 'r1', title: 'Okonomiyaki', cuisines: ['japanese'], draft: false, deleted: false, ...over }) as Recipe;
  const item = (id: string, is_done: boolean) => ({ id, checklist_id: 'c1', is_done, deleted: false }) as ChecklistTaskItem;

  it('builds rows from live data and drops missing, deleted or draft items', () => {
    const refs = replyItemRefs(
      '[A](/recipes/r1) [B](/recipes/r2) [C](/recipes/r3) [D](/checklists/c1) [E](/shopper/w1) [F](/apartment/a1) [G](/recipes/gone)',
    );
    const rows = replyItemRows(refs, {
      recipes: { r1: recipe({ to_try: true }), r2: recipe({ id: 'r2', deleted: true }), r3: recipe({ id: 'r3', draft: true }) },
      checklists: { c1: { id: 'c1', title: 'Market run', completed_at: null, deleted: false } as Checklist },
      checklistItems: [item('i1', true), item('i2', false)],
      watches: { w1: { id: 'w1', title: 'Kettle', status: 'watching', best_cents: 4500, target_cents: 5000, deleted: false } as ShopperWant },
      listings: { a1: { id: 'a1', address: '12 Rose St', suburb: 'Fitzroy', rent_per_week: 650, deleted: false } as Apartment },
    });
    expect(rows.map((r) => [r.kind, r.title, r.meta, r.good])).toEqual([
      ['recipe', 'Okonomiyaki', 'To try · Japanese', false],
      ['checklist', 'Market run', '1 of 2 done', false],
      ['watch', 'Kettle', `Best ${formatMoney(4500)} · target ${formatMoney(5000)}`, true],
      ['listing', '12 Rose St', `Fitzroy · ${formatMoney(65000)}/wk`, false],
    ]);
    expect(rows[0]).toMatchObject({ module: 'recipes', toTry: true, href: '/recipes/r1' });
  });

  it('marks a finished list as good', () => {
    const refs = replyItemRefs('[L](/checklists/c1)');
    const rows = replyItemRows(refs, {
      checklists: { c1: { id: 'c1', title: 'Packing', completed_at: null, deleted: false } as Checklist },
      checklistItems: [item('i1', true)],
    });
    expect(rows[0]).toMatchObject({ meta: 'All done', good: true });
  });
});
