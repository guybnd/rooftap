import { describe, expect, it } from 'vitest';
import { changeCaption, changeFromRun, changeVerb } from './assistant-api';
import { changeGroups } from './assistant-view';

describe('changeFromRun', () => {
  it('takes the new id from a create result', () => {
    const c = changeFromRun('create_task', 'household', { title: 'Cancel Uber One' }, JSON.stringify({ id: 't1', title: 'Cancel Uber One' }));
    expect(c).toMatchObject({ tool: 'create_task', module: 'household', verb: 'added', id: 't1' });
    expect(c.summary).toContain('Cancel Uber One');
  });

  it('falls back to an _id argument', () => {
    expect(changeFromRun('update_task', 'household', { task_id: 't2', title: 'x' }, 'not json').id).toBe('t2');
  });

  it('has no id when neither says one', () => {
    expect(changeFromRun('set_meal', 'meals', { date: '2026-11-08' }, '{"ok":true}').id).toBeNull();
  });
});

describe('change wording', () => {
  it('reads the verb from the tool name', () => {
    expect(changeVerb('create_event')).toBe('added');
    expect(changeVerb('delete_task')).toBe('removed');
    expect(changeVerb('complete_task')).toBe('changed');
  });

  it('captions one or many', () => {
    const one = changeFromRun('create_task', 'household', {}, '{"id":"a"}');
    expect(changeCaption([one], 'Tasks')).toBe('Added to Tasks');
    expect(changeCaption([one, one, one], 'Groceries')).toBe('3 added to Groceries');
    const del = changeFromRun('delete_task', 'household', { task_id: 'b' });
    expect(changeCaption([one, del], 'Tasks')).toBe('2 changes in Tasks');
  });
});

describe('changeGroups', () => {
  it('groups by module, keeps one entry per item and knows the row kind', () => {
    const a = changeFromRun('create_task', 'household', {}, '{"id":"a"}');
    const a2 = changeFromRun('update_task', 'household', { task_id: 'a' });
    const meal = changeFromRun('set_meal', 'meals', { date: '2026-11-08' });
    const groups = changeGroups([a, meal, a2]);
    expect(groups.map((g) => [g.module, g.rowKind, g.changes.length])).toEqual([
      ['household', 'tasks', 1],
      ['meals', null, 1],
    ]);
    expect(groups[0].label).toBe('Tasks');
    expect(groups[0].href).toBe('/tasks');
  });
});
