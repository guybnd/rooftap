import { describe, expect, it } from 'vitest';
import {
  checkedToastLabel,
  buildAppendedItems,
  buildLinkedTask,
  findDuplicateLabel,
  linkNewChecklistToTask,
  normalizeLabel,
  renameChecklistPatch,
  renameItemPatch,
  setItemCostPatch,
  spendTotals,
  splitPastedItems,
  splitPastedIntoField,
  typeDescription,
  typeMeta,
} from './checklists';
import type { ChecklistTaskItem, ChecklistType, HouseholdTask } from './types';

function task(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: 'task-1',
    group_id: 'g1',
    title: 'Pack for the trip',
    due_date: '2026-09-20',
    due_time: null,
    offset_days: null,
    recurrence_days: null,
    done: false,
    completed_at: null,
    assigned_to: null,
    private: false,
    template_key: null,
    notes: null,
    sort_order: 0,
    linked_checklist_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

function item(overrides: Partial<ChecklistTaskItem> = {}): ChecklistTaskItem {
  return {
    id: 'i1',
    checklist_id: 'c1',
    group_id: 'g1',
    label: 'Milk',
    is_done: false,
    checked_by: null,
    checked_at: null,
    cost_cents: null,
    linked_cost_item_id: null,
    order: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

describe('splitPastedItems', () => {
  it('splits on newlines, trims, and drops empty lines', () => {
    expect(splitPastedItems('Milk\n  Eggs  \n\n\nBread\n')).toEqual(['Milk', 'Eggs', 'Bread']);
  });

  it('handles CRLF line endings', () => {
    expect(splitPastedItems('Milk\r\nEggs\r\n')).toEqual(['Milk', 'Eggs']);
  });

  it('strips leading bullets, numbering and markdown checkboxes', () => {
    expect(
      splitPastedItems('- Milk\n* Eggs\n• Bread\n1. Butter\n2) Jam\n- [ ] Cheese\n- [x] Yoghurt'),
    ).toEqual(['Milk', 'Eggs', 'Bread', 'Butter', 'Jam', 'Cheese', 'Yoghurt']);
  });

  it('keeps a hyphenated or numeric label intact when it is not a marker', () => {
    expect(splitPastedItems('Ice-cream\n2 lemons')).toEqual(['Ice-cream', '2 lemons']);
  });

  it('returns a single label for single-line text', () => {
    expect(splitPastedItems('  Milk ')).toEqual(['Milk']);
  });
});

describe('splitPastedIntoField', () => {
  it('merges the paste at the caret inside existing text', () => {
    // "Milk|Bread" with caret at 4, pasting "\nEggs\n" between them.
    expect(
      splitPastedIntoField({ current: 'MilkBread', pasted: '\nEggs\n', selectionStart: 4, selectionEnd: 4 }),
    ).toEqual(['Milk', 'Eggs', 'Bread']);
  });

  it('replaces a selection with the pasted text', () => {
    // "Milk[XXXX]Bread" — selection XXXX (4-8) is replaced by the paste.
    expect(
      splitPastedIntoField({
        current: 'MilkXXXXBread',
        pasted: 'Eggs\nButter',
        selectionStart: 4,
        selectionEnd: 8,
      }),
    ).toEqual(['MilkEggs', 'ButterBread']);
  });

  it('returns [] when the paste yields no usable label', () => {
    expect(splitPastedIntoField({ current: '', pasted: '\n\n' })).toEqual([]);
    expect(splitPastedIntoField({ current: '', pasted: '- \n- ' })).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    expect(splitPastedIntoField({ current: '', pasted: 'Milk\r\nEggs\r\n' })).toEqual(['Milk', 'Eggs']);
  });

  it('handles a single line with a trailing newline', () => {
    expect(splitPastedIntoField({ current: '', pasted: 'Milk\n' })).toEqual(['Milk']);
  });

  it('appends at the end when no selection is given (mobile: current merged value)', () => {
    expect(splitPastedIntoField({ current: '', pasted: 'Milk\nEggs' })).toEqual(['Milk', 'Eggs']);
  });
});

describe('normalizeLabel', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeLabel('  Oat   Milk ')).toBe('oat milk');
  });
});

describe('findDuplicateLabel', () => {
  const items = [
    item({ id: 'milk', label: 'Milk' }),
    item({ id: 'eggs', label: 'Free range eggs', order: 1 }),
    item({ id: 'gone', label: 'Bread', order: 2, deleted: true }),
    item({ id: 'done', label: 'Butter', order: 3, is_done: true }),
  ];

  it('matches ignoring case and whitespace', () => {
    expect(findDuplicateLabel(items, ' milk ')?.id).toBe('milk');
    expect(findDuplicateLabel(items, 'FREE  RANGE eggs')?.id).toBe('eggs');
  });

  it('ignores soft-deleted items', () => {
    expect(findDuplicateLabel(items, 'Bread')).toBeNull();
  });

  it('still counts checked-off items as on the list', () => {
    expect(findDuplicateLabel(items, 'butter')?.id).toBe('done');
  });

  it('returns null for blank input and non-matches', () => {
    expect(findDuplicateLabel(items, '   ')).toBeNull();
    expect(findDuplicateLabel(items, 'Cheese')).toBeNull();
  });
});

describe('buildAppendedItems', () => {
  const existing = [item({ id: 'a', order: 4 }), item({ id: 'b', order: 9, deleted: true }), item({ id: 'c', order: 7 })];

  it('sequences a batch after the live tail, in paste order', () => {
    const rows = buildAppendedItems({
      checklistId: 'c1',
      groupId: 'g1',
      labels: ['Eggs', 'Bread', 'Jam'],
      existing,
    });
    expect(rows.map((r) => r.label)).toEqual(['Eggs', 'Bread', 'Jam']);
    expect(rows.map((r) => r.order)).toEqual([8, 9, 10]);
    expect(rows.every((r) => r.checklist_id === 'c1' && r.group_id === 'g1' && !r.is_done)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('starts at 0 on an empty list', () => {
    expect(buildAppendedItems({ checklistId: 'c1', groupId: 'g1', labels: ['Milk'], existing: [] })[0].order).toBe(0);
  });

  it('applies the cost to a single typed item only', () => {
    const single = buildAppendedItems({ checklistId: 'c1', groupId: 'g1', labels: ['Milk'], existing: [], costCents: 300 });
    expect(single[0].cost_cents).toBe(300);
    const batch = buildAppendedItems({ checklistId: 'c1', groupId: 'g1', labels: ['Milk', 'Eggs'], existing: [], costCents: 300 });
    expect(batch.map((r) => r.cost_cents)).toEqual([null, null]);
  });

  it('drops blank labels', () => {
    expect(buildAppendedItems({ checklistId: 'c1', groupId: 'g1', labels: ['  ', 'Milk'], existing: [] })).toHaveLength(1);
  });
});

describe('spendTotals', () => {
  it('sums priced live items, counting done ones as spent', () => {
    const items = [
      item({ id: 'a', cost_cents: 300, is_done: true }),
      item({ id: 'b', cost_cents: 1190, is_done: true }),
      item({ id: 'c', cost_cents: 1500 }),
      item({ id: 'd', cost_cents: 2220 }),
    ];
    expect(spendTotals(items)).toEqual({ spentCents: 1490, totalCents: 5210 });
  });

  it('treats unpriced items as 0 and ignores soft-deleted rows', () => {
    const items = [
      item({ id: 'a', cost_cents: null, is_done: true }),
      item({ id: 'b', cost_cents: 400 }),
      item({ id: 'c', cost_cents: 9999, is_done: true, deleted: true }),
    ];
    expect(spendTotals(items)).toEqual({ spentCents: 0, totalCents: 400 });
  });

  it('returns zeros for an empty or fully unpriced list', () => {
    expect(spendTotals([])).toEqual({ spentCents: 0, totalCents: 0 });
    expect(spendTotals([item({ id: 'a' }), item({ id: 'b', is_done: true })])).toEqual({ spentCents: 0, totalCents: 0 });
  });
});

describe('renameItemPatch', () => {
  it('trims and returns a label patch', () => {
    expect(renameItemPatch('  New label  ')).toEqual({ label: 'New label' });
  });

  it('reverts (returns null) on an empty/whitespace-only submit', () => {
    expect(renameItemPatch('')).toBeNull();
    expect(renameItemPatch('   ')).toBeNull();
  });
});

describe('setItemCostPatch', () => {
  it('converts dollars to cents', () => {
    expect(setItemCostPatch('3.50')).toEqual({ cost_cents: 350 });
  });

  it('clears to null on an empty string', () => {
    expect(setItemCostPatch('')).toEqual({ cost_cents: null });
  });
});

describe('renameChecklistPatch', () => {
  it('trims and returns a title patch', () => {
    expect(renameChecklistPatch('  New Title  ')).toEqual({ title: 'New Title' });
  });

  it('reverts (returns null) on an empty/whitespace-only submit', () => {
    expect(renameChecklistPatch('')).toBeNull();
    expect(renameChecklistPatch('   ')).toBeNull();
  });
});

describe('linkNewChecklistToTask', () => {
  it('carries the task title/group/date, is a plain list, and links both directions', () => {
    const t = task({ id: 'task-9', group_id: 'g9', title: 'Ski trip', due_date: '2026-10-01' });
    const { checklist, taskPatch } = linkNewChecklistToTask({ task: t, createdBy: 'user-1' });

    expect(checklist.group_id).toBe('g9');
    expect(checklist.title).toBe('Ski trip');
    expect(checklist.type).toBe('plain');
    expect(checklist.scheduled_date).toBe('2026-10-01');
    expect(checklist.created_by).toBe('user-1');
    expect(checklist.linked_task_id).toBe('task-9');
    expect(taskPatch).toEqual({ linked_checklist_id: checklist.id });
  });

  it('writes no completion field on either side', () => {
    const { checklist } = linkNewChecklistToTask({ task: task() });
    expect(checklist.completed_at).toBeNull();
  });

  it('does not invoke buildLinkedTask\'s shape — the task already exists, this only produces the checklist + a task patch', () => {
    const t = task({ id: 'task-1' });
    const { checklist, taskPatch } = linkNewChecklistToTask({ task: t });
    // The checklist is the new row; buildLinkedTask would instead build a NEW
    // household_tasks row, which is not what this function returns.
    expect(checklist.id).not.toBe(t.id);
    expect(Object.keys(taskPatch)).toEqual(['linked_checklist_id']);
    // Sanity: buildLinkedTask remains the reverse-direction builder, unaffected.
    const linkedTask = buildLinkedTask({ checklist });
    expect(linkedTask.linked_checklist_id).toBe(checklist.id);
  });
});

// Modules (.docs/modules.md): a type's description drops the dashboard
// promise with Tasks off and the purchase-logging promise with Costs off;
// every other type is unchanged.
describe('typeDescription', () => {
  const cases: { type: ChecklistType; linkedTask: boolean; logCosts: boolean; mentions: string | null }[] = [
    { type: 'plain', linkedTask: true, logCosts: true, mentions: 'dashboard' },
    { type: 'plain', linkedTask: false, logCosts: true, mentions: null },
    { type: 'plain', linkedTask: true, logCosts: false, mentions: 'dashboard' },
    { type: 'shopping', linkedTask: true, logCosts: true, mentions: 'purchase' },
    { type: 'shopping', linkedTask: true, logCosts: false, mentions: null },
    { type: 'shopping', linkedTask: false, logCosts: true, mentions: 'purchase' },
    { type: 'repeating', linkedTask: false, logCosts: false, mentions: 'cadence' },
  ];

  it.each(cases)('$type with linkedTask $linkedTask, logCosts $logCosts', ({ type, linkedTask, logCosts, mentions }) => {
    const text = typeDescription(type, { linkedTask, logCosts });
    if (mentions) {
      expect(text).toBe(typeMeta(type).description);
      expect(text).toContain(mentions);
    } else {
      expect(text).not.toMatch(/dashboard|purchase|Household Buy/);
    }
  });
});

describe('checkedToastLabel', () => {
  it('names one tick, then counts', () => {
    expect(checkedToastLabel(1)).toBe('Item checked');
    expect(checkedToastLabel(3)).toBe('3 items checked');
  });
});
