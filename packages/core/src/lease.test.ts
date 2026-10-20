import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LEASE_REMINDER_TITLE,
  describeLease,
  getLeaseStatus,
  leaseReminderDueDate,
  leaseReminderKey,
  parseNoticeDays,
  syncLeaseReminder,
} from './lease';
import { parseReminderKey } from './reminders';
import { taskOwnerModule } from './task-modules';

const TODAY = '2026-10-19';

describe('getLeaseStatus', () => {
  it('is none without an end date', () => {
    expect(getLeaseStatus({ leaseEndDate: null, noticeDays: 30 }, TODAY).phase).toBe('none');
  });

  it('counts down to the notice deadline and the end', () => {
    const s = getLeaseStatus({ leaseEndDate: '2027-01-11', noticeDays: 30 }, TODAY);
    expect(s).toEqual({ phase: 'notice-ahead', noticeDeadline: '2026-12-12', daysToNotice: 54, daysToEnd: 84 });
  });

  it('treats a missing notice period as notice due on the end date', () => {
    expect(getLeaseStatus({ leaseEndDate: '2026-11-01', noticeDays: null }, TODAY).noticeDeadline).toBe('2026-11-01');
  });

  it('knows when the deadline passed and when the lease ended', () => {
    expect(getLeaseStatus({ leaseEndDate: '2026-11-01', noticeDays: 30 }, TODAY).phase).toBe('notice-passed');
    expect(getLeaseStatus({ leaseEndDate: '2026-10-18', noticeDays: 30 }, TODAY).phase).toBe('ended');
    expect(getLeaseStatus({ leaseEndDate: TODAY, noticeDays: 0 }, TODAY).phase).toBe('notice-ahead');
  });
});

describe('leaseReminderDueDate', () => {
  it('lands two weeks before the notice deadline', () => {
    expect(leaseReminderDueDate({ leaseEndDate: '2027-01-11', noticeDays: 30 }, TODAY)).toBe('2026-11-28');
  });

  it('is today once that lead date has passed, and null once the lease ended', () => {
    expect(leaseReminderDueDate({ leaseEndDate: '2026-11-20', noticeDays: 30 }, TODAY)).toBe(TODAY);
    expect(leaseReminderDueDate({ leaseEndDate: '2026-10-01', noticeDays: 30 }, TODAY)).toBeNull();
    expect(leaseReminderDueDate({ leaseEndDate: null, noticeDays: 30 }, TODAY)).toBeNull();
  });
});

describe('describeLease', () => {
  it('invites renters to set a date, mentioning Tasks only when it is on', () => {
    expect(describeLease({ leaseEndDate: null, noticeDays: null }, { tasksOn: true, today: TODAY })).toMatch(/reminder in Tasks/);
    expect(describeLease({ leaseEndDate: null, noticeDays: null }, { tasksOn: false, today: TODAY })).not.toMatch(/Tasks/);
  });

  it('states the deadline, the time left and when the reminder lands', () => {
    expect(describeLease({ leaseEndDate: '2027-01-11', noticeDays: 30 }, { tasksOn: true, today: TODAY })).toBe(
      'Give notice by Dec 12, in 54 days. The lease ends Jan 11, 2027. A reminder lands in Tasks on Nov 28.',
    );
    expect(describeLease({ leaseEndDate: '2027-01-11', noticeDays: 30 }, { tasksOn: false, today: TODAY })).toBe(
      'Give notice by Dec 12, in 54 days. The lease ends Jan 11, 2027.',
    );
  });

  it('covers a passed deadline, no notice period and an ended lease', () => {
    expect(describeLease({ leaseEndDate: '2026-11-01', noticeDays: 30 }, { tasksOn: true, today: TODAY })).toBe(
      'The notice deadline passed 17 days ago. The lease ends Nov 1, in 13 days. The reminder is in Tasks now.',
    );
    expect(describeLease({ leaseEndDate: '2026-12-31', noticeDays: 0 }, { tasksOn: false, today: TODAY })).toBe(
      'The lease ends Dec 31, in 73 days.',
    );
    expect(describeLease({ leaseEndDate: '2026-10-01', noticeDays: 30 }, { tasksOn: true, today: TODAY })).toBe(
      'The lease ended on Oct 1. Set the new end date if you renewed.',
    );
  });

  it('never uses an em-dash', () => {
    for (const end of [null, '2026-10-01', '2026-11-01', '2027-01-11']) {
      expect(describeLease({ leaseEndDate: end, noticeDays: 30 }, { tasksOn: true, today: TODAY })).not.toMatch(/—/);
    }
  });
});

describe('parseNoticeDays', () => {
  it('accepts whole days in range only', () => {
    expect(parseNoticeDays(' 30 ')).toBe(30);
    expect(parseNoticeDays('0')).toBe(0);
    expect(parseNoticeDays('')).toBeNull();
    expect(parseNoticeDays('2.5')).toBeNull();
    expect(parseNoticeDays('-3')).toBeNull();
    expect(parseNoticeDays('731')).toBeNull();
  });
});

describe('the lease reminder key', () => {
  it('parses as a lease reminder owned by Tasks', () => {
    const key = leaseReminderKey('group-1');
    expect(parseReminderKey(key)).toEqual({ kind: 'lease', originId: 'group-1', sub: 'notice' });
    expect(taskOwnerModule({ template_key: key })).toBe('household');
  });
});

// A minimal household_tasks fake: one optional existing row, recording writes.
function fakeSupabase(existing: { id: string } | null) {
  const writes: { op: string; payload?: unknown; id?: unknown }[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (col: string, val: unknown) => {
      const pending = writes[writes.length - 1];
      if (col === 'id' && pending && pending.id === undefined) pending.id = val;
      return chain;
    };
    chain.maybeSingle = async () => ({ data: existing, error: null });
    chain.single = async () => ({ data: { id: 'new-task' }, error: null });
    chain.delete = () => { writes.push({ op: 'delete' }); return chain; };
    chain.update = (payload: unknown) => { writes.push({ op: 'update', payload }); return chain; };
    chain.insert = (payload: unknown) => { writes.push({ op: 'insert', payload }); return chain; };
    chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, writes };
}

describe('syncLeaseReminder', () => {
  const terms = { leaseEndDate: '2027-01-11', noticeDays: 30 };

  it('inserts one reminder for a new lease', async () => {
    const { client, writes } = fakeSupabase(null);
    expect(await syncLeaseReminder(client, { groupId: 'g', terms, today: TODAY })).toBe('new-task');
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('insert');
    expect(writes[0].payload).toMatchObject({
      group_id: 'g',
      title: LEASE_REMINDER_TITLE,
      due_date: '2026-11-28',
      template_key: leaseReminderKey('g'),
      done: false,
    });
  });

  it('moves an existing reminder, reopening it only for a new lease term', async () => {
    const moved = fakeSupabase({ id: 't1' });
    await syncLeaseReminder(moved.client, { groupId: 'g', terms, today: TODAY });
    expect(moved.writes[0]).toMatchObject({ op: 'update', id: 't1' });
    expect(moved.writes[0].payload).not.toHaveProperty('done');

    const renewed = fakeSupabase({ id: 't1' });
    await syncLeaseReminder(renewed.client, { groupId: 'g', terms, reopen: true, today: TODAY });
    expect(renewed.writes[0].payload).toMatchObject({ done: false, completed_at: null, due_date: '2026-11-28' });
  });

  it('removes the reminder when the date is cleared', async () => {
    const { client, writes } = fakeSupabase({ id: 't1' });
    expect(await syncLeaseReminder(client, { groupId: 'g', terms: { leaseEndDate: null, noticeDays: 30 }, today: TODAY })).toBeNull();
    expect(writes).toEqual([{ op: 'delete', id: 't1' }]);
  });
});
