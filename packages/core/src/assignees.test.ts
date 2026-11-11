import { describe, expect, it } from 'vitest';
import { assigneePatch, assigneesOf, isAssignedTo, peopleLabel, toggleAssignee } from './assignees';
import * as twin from '../../../supabase/functions/_shared/assignees';

describe('assigneesOf', () => {
  it('reads the list, or the one person on an older row', () => {
    expect(assigneesOf({ assigned_to: 'a', assignees: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(assigneesOf({ assigned_to: 'a' })).toEqual(['a']);
    expect(assigneesOf({ assigned_to: null, assignees: null })).toEqual([]);
  });

  it('lets an older app’s change win over a stale list', () => {
    expect(assigneesOf({ assigned_to: 'c', assignees: ['a', 'b'] })).toEqual(['c']);
    expect(assigneesOf({ assigned_to: null, assignees: ['a', 'b'] })).toEqual([]);
  });

  it('reads the same in the edge functions', () => {
    for (const row of [{ assigned_to: 'a', assignees: ['a', 'b'] }, { assigned_to: 'c', assignees: ['a'] }, { assigned_to: null }]) {
      expect(twin.assigneesOf(row)).toEqual(assigneesOf(row));
    }
  });
});

describe('assignee helpers', () => {
  it('checks one person', () => {
    expect(isAssignedTo({ assigned_to: 'a', assignees: ['a', 'b'] }, 'b')).toBe(true);
    expect(isAssignedTo({ assigned_to: 'a' }, 'b')).toBe(false);
    expect(isAssignedTo({ assigned_to: 'a' }, null)).toBe(false);
  });

  it('toggles a person in the order added', () => {
    expect(toggleAssignee(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleAssignee(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('writes the first person, and the list only when the server has it', () => {
    expect(assigneePatch(['a', 'b', 'a'], true)).toEqual({ assigned_to: 'a', assignees: ['a', 'b'] });
    expect(assigneePatch([], true)).toEqual({ assigned_to: null, assignees: null });
    expect(assigneePatch(['a', 'b'], false)).toEqual({ assigned_to: 'a' });
  });

  it('names the people picked', () => {
    expect(peopleLabel([], 'Anyone')).toBe('Anyone');
    expect(peopleLabel(['Sam'], 'Anyone')).toBe('Sam');
    expect(peopleLabel(['Sam', 'Kim'], 'Anyone')).toBe('Sam and Kim');
    expect(peopleLabel(['Sam', 'Kim', 'Jo'], 'Anyone')).toBe('Sam +2');
  });

  it('tells only the people newly added', () => {
    expect(twin.addedAssignees({ assigned_to: 'a', assignees: ['a'] }, { assigned_to: 'a', assignees: ['a', 'b'] })).toEqual(['b']);
    expect(twin.addedAssignees(null, { assigned_to: 'a' })).toEqual(['a']);
    expect(twin.addedAssignees({ assigned_to: 'a' }, { assigned_to: 'a', assignees: ['a'] })).toEqual([]);
  });
});
