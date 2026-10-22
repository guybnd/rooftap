import { describe, expect, it } from 'vitest';
import {
  parseScoutFollowUp,
  scoutAsksUsed,
  scoutBriefChanges,
  scoutLatestRun,
  scoutRefineLine,
  scoutSuggestions,
  scoutTimeline,
  type ScoutMessage,
} from './shopper-scout-thread';
import type { ScoutBrief, ShopperPick, ShopperSearch } from './shopper-scout';

const brief: ScoutBrief = { text: 'Microwave, 25L', budget_min_cents: null, budget_max_cents: 12000, need_by: null, where: ['nearby', 'online'] };

function run(id: string, at: string, extra: Partial<ShopperSearch> = {}): ShopperSearch {
  return {
    id,
    group_id: 'g',
    brief,
    status: 'done',
    error: null,
    stores_checked: 3,
    key_source: 'server',
    created_by: 'u',
    created_at: at,
    updated_at: at,
    finished_at: at,
    thread_id: null,
    deleted: false,
    ...extra,
  };
}

function pick(id: string, searchId: string, rank: number): ShopperPick {
  return {
    id,
    group_id: 'g',
    search_id: searchId,
    rank,
    label: '',
    title: `Pick ${id}`,
    why: '',
    price_cents: 14500,
    currency: 'AUD',
    store: 'Store',
    url: null,
    in_stock: null,
    stretch: false,
    sources: [],
    want_id: null,
    created_at: '',
    updated_at: '',
    deleted: false,
  };
}

function msg(id: string, at: string, role: ScoutMessage['role'], extra: Partial<ScoutMessage> = {}): ScoutMessage {
  return { id, group_id: 'g', thread_id: 'r1', role, text: id, pick_id: null, search_id: null, created_by: 'u', created_at: at, updated_at: at, deleted: false, ...extra };
}

describe('parseScoutFollowUp', () => {
  it('needs words, caps length and keeps only a real pick id', () => {
    expect(parseScoutFollowUp({ text: '  ' })).toEqual({ error: 'Write a question or a change first.' });
    expect('error' in parseScoutFollowUp({ text: 'x'.repeat(401) })).toBe(true);
    expect(parseScoutFollowUp({ text: ' Why? ', pick_id: 'nope' })).toEqual({ text: 'Why?', pick_id: null });
    const id = '0b5c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';
    expect(parseScoutFollowUp({ text: 'Why?', pick_id: id })).toEqual({ text: 'Why?', pick_id: id });
  });

  it('counts only what the person sent', () => {
    expect(scoutAsksUsed([msg('a', '1', 'user'), msg('b', '2', 'scout'), msg('c', '3', 'user', { deleted: true })])).toBe(1);
  });
});

describe('scoutTimeline', () => {
  it('puts the first run first and a refined run right after the message that started it', () => {
    const r1 = run('r1', '2026-10-22T01:00:00Z');
    const r2 = run('r2', '2026-10-22T01:05:00Z', { thread_id: 'r1' });
    const items = scoutTimeline({
      runs: [r2, r1],
      picks: [pick('p2', 'r1', 2), pick('p1', 'r1', 1), pick('p3', 'r2', 1)],
      messages: [
        msg('ask', '2026-10-22T01:02:00Z', 'user'),
        msg('answer', '2026-10-22T01:02:05Z', 'scout'),
        msg('change', '2026-10-22T01:04:59Z', 'user'),
        // Saved just after the run it started.
        msg('again', '2026-10-22T01:05:01Z', 'scout', { search_id: 'r2' }),
      ],
    });
    expect(items.map((i) => (i.kind === 'run' ? i.run.id : i.message.id))).toEqual(['r1', 'ask', 'answer', 'change', 'again', 'r2']);
    const first = items[0];
    expect(first.kind === 'run' && first.first && first.picks.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('slots in a run no message names by time', () => {
    const items = scoutTimeline({
      runs: [run('r1', '2026-10-22T01:00:00Z'), run('r2', '2026-10-22T01:03:00Z', { thread_id: 'r1' })],
      picks: [],
      messages: [msg('a', '2026-10-22T01:02:00Z', 'user'), msg('b', '2026-10-22T01:04:00Z', 'user')],
    });
    expect(items.map((i) => (i.kind === 'run' ? i.run.id : i.message.id))).toEqual(['r1', 'a', 'r2', 'b']);
  });
});

describe('scoutLatestRun', () => {
  it('is the newest run with picks, so a running refine keeps the old Hero', () => {
    const r1 = run('r1', '2026-10-22T01:00:00Z');
    const r2 = run('r2', '2026-10-22T01:05:00Z', { thread_id: 'r1', status: 'running' });
    expect(scoutLatestRun({ runs: [r1, r2], picks: [pick('p', 'r1', 1)], messages: [] })?.id).toBe('r1');
    expect(scoutLatestRun({ runs: [r1, { ...r2, status: 'done' }], picks: [pick('p', 'r1', 1), pick('q', 'r2', 1)], messages: [] })?.id).toBe('r2');
  });
});

describe('refine wording', () => {
  it('names budget, date and where changes', () => {
    expect(scoutBriefChanges(brief, { ...brief, budget_max_cents: 16000 })).toEqual(['up to $160']);
    expect(scoutBriefChanges(brief, { ...brief, where: ['nearby'] })).toEqual(['nearby']);
    expect(scoutBriefChanges(brief, brief)).toEqual([]);
  });

  it("joins the changes with Scout's own summary, without repeats or em-dashes", () => {
    expect(scoutRefineLine('with a grill.', ['up to $160'])).toBe('Searching again: up to $160, with a grill.');
    expect(scoutRefineLine('up to $160 — with a grill', ['up to $160'])).toBe('Searching again: up to $160, with a grill.');
    expect(scoutRefineLine('', [])).toBe('Searching again.');
  });

  it('suggests follow-ups from the picks', () => {
    const stretch = { ...pick('a', 'r1', 1), stretch: true };
    expect(scoutSuggestions([stretch, { ...stretch, rank: 2 }], brief)).toEqual(['Compare 1 and 2', 'Why nothing in budget?', 'Any cheaper options?']);
    expect(scoutSuggestions([], brief)).toEqual(['Try a bigger budget']);
  });
});
