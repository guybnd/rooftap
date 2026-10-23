import { describe, expect, it } from 'vitest';
import { isOverBudget, parseScoutBrief, readScoutPrefill, scoutPrefillFromSetupItem, scoutPrefillHref, scoutFailure, scoutRunStatus, scoutStoresCaption, scoutTitle, SCOUT_STALE_MS } from './shopper-scout';

describe('parseScoutBrief', () => {
  it('needs some words, and keeps it short', () => {
    expect(parseScoutBrief({ text: ' ' })).toEqual({ error: 'Say what you are after first.' });
    expect('error' in parseScoutBrief({ text: 'x'.repeat(601) })).toBe(true);
  });

  it('cleans budget, date and where, defaulting where to nearby and online', () => {
    const out = parseScoutBrief({ text: 'A quiet dishwasher', budget_min_cents: 200000, budget_max_cents: 90000, need_by: 'soon', where: ['online', 'online', 'mars'] });
    expect(out).toEqual({ brief: { text: 'A quiet dishwasher', budget_min_cents: 90000, budget_max_cents: 200000, need_by: null, where: ['online'] } });
    const plain = parseScoutBrief({ text: 'A kettle', budget_max_cents: 12.5, need_by: '2026-11-01' });
    expect(plain).toMatchObject({ brief: { budget_max_cents: null, need_by: '2026-11-01', where: ['nearby', 'online'] } });
  });
});

describe('scout helpers', () => {
  it('titles a run from its first clause', () => {
    expect(scoutTitle({ text: 'A 65 inch OLED. Mostly for films' })).toBe('A 65 inch OLED');
  });

  it('flags over-budget picks only when there is a budget', () => {
    expect(isOverBudget({ price_cents: 210000 }, { budget_max_cents: 200000 })).toBe(true);
    expect(isOverBudget({ price_cents: 210000 }, { budget_max_cents: null })).toBe(false);
  });

  it('shows a run that never finished as failed', () => {
    const created_at = '2026-10-21T00:00:00Z';
    const t = new Date(created_at).getTime();
    expect(scoutRunStatus({ status: 'running', created_at }, t + 1000)).toBe('running');
    expect(scoutRunStatus({ status: 'running', created_at }, t + SCOUT_STALE_MS + 1)).toBe('failed');
    expect(scoutFailure({ status: 'running', error: null, created_at }, t + SCOUT_STALE_MS + 1)).toMatch(/stopped/);
    expect(scoutFailure({ status: 'done', error: null, created_at }, t)).toBeNull();
  });

  it('counts stores in the caption', () => {
    expect(scoutStoresCaption({ stores_checked: 1 })).toBe('checked 1 store');
    expect(scoutStoresCaption({ stores_checked: 0 })).toBeNull();
  });
});

describe('scout prefill', () => {
  it('turns a setup item into a brief with its estimate as the budget', () => {
    expect(scoutPrefillFromSetupItem({ name: ' Robot vacuum ', notes: 'Pet hair, mostly tiles', est_price: 600 })).toEqual({
      text: 'Robot vacuum. Pet hair, mostly tiles',
      upTo: '600',
    });
    expect(scoutPrefillFromSetupItem({ name: 'Kettle', notes: null, est_price: null })).toEqual({ text: 'Kettle', upTo: '' });
  });

  it('round-trips through the Shopper route', () => {
    const href = scoutPrefillHref({ text: 'Bar fridge & ice', upTo: '300' });
    expect(href.startsWith('/shopper?')).toBe(true);
    const params = Object.fromEntries(new URLSearchParams(href.split('?')[1]));
    expect(readScoutPrefill(params)).toEqual({ text: 'Bar fridge & ice', upTo: '300' });
    expect(scoutPrefillHref({ text: 'Lamp', upTo: '' })).toBe('/shopper?scout=Lamp');
  });

  it('ignores an empty or missing brief', () => {
    expect(readScoutPrefill({})).toBeNull();
    expect(readScoutPrefill({ scout: ['  '] })).toBeNull();
    expect(readScoutPrefill({ scout: ['Desk'], upto: '$1,200' })).toEqual({ text: 'Desk', upTo: '1200' });
  });
});
