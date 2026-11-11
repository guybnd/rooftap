import { describe, expect, it } from 'vitest';
import { FIRST_WEEK_DAYS, firstWeekSteps, firstWeekWidgetHelp, firstWeekVisible, parseFirstWeekState, type FirstWeekInput } from './first-week';

const base: FirstWeekInput = {
  platform: 'web',
  dinnerOn: true,
  billOn: true,
  dinnerPlanned: false,
  hasCost: false,
  memberCount: 1,
  tapped: new Set(),
};

describe('firstWeekSteps', () => {
  it('lists the steps in order, the tiles already done', () => {
    const steps = firstWeekSteps(base);
    expect(steps.map((s) => s.id)).toEqual(['tiles', 'dinner', 'bill', 'invite', 'widget']);
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(['tiles']);
  });

  it('leaves out a step whose tile is off', () => {
    const steps = firstWeekSteps({ ...base, dinnerOn: false, billOn: false });
    expect(steps.map((s) => s.id)).toEqual(['tiles', 'invite', 'widget']);
  });

  it('marks steps done from the household or from a tap', () => {
    const steps = firstWeekSteps({ ...base, dinnerPlanned: true, hasCost: true, memberCount: 2, tapped: new Set(['widget']) });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('names the widget on the phone', () => {
    expect(firstWeekSteps({ ...base, platform: 'phone' }).at(-1)?.title).toContain('Skylight');
  });
});

describe('the last step on web', () => {
  it('asks an iPhone tab to add Rooftap to the Home Screen', () => {
    const step = firstWeekSteps({ ...base, webDevice: 'ios-browser' }).at(-1);
    expect(step?.title).toBe('Add Rooftap to your Home Screen');
    expect(step?.href).toBeNull();
    expect(firstWeekWidgetHelp('web', 'ios-browser').message).toContain('Add to Home Screen');
  });

  it('asks an installed app to turn on notifications, done once they are on', () => {
    const step = firstWeekSteps({ ...base, webDevice: 'ios-installed' }).at(-1);
    expect(step?.title).toBe('Turn on notifications');
    expect(step?.href).toBe('/settings/you');
    expect(step?.done).toBe(false);
    expect(firstWeekSteps({ ...base, webDevice: 'installed', notificationsOn: true }).at(-1)?.done).toBe(true);
  });

  it('points a computer at the phone, iPhone included', () => {
    expect(firstWeekSteps({ ...base, webDevice: 'desktop' }).at(-1)?.title).toBe('Get Rooftap on your phone');
    expect(firstWeekWidgetHelp('web', 'desktop').message).toContain('iPhone');
  });
});

describe('firstWeekVisible', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const steps = firstWeekSteps(base);

  it('shows for a new household with a step open', () => {
    expect(firstWeekVisible({ groupCreatedAt: '2026-11-09T10:00:00Z', now, dismissed: false, steps })).toBe(true);
  });

  it('hides once dismissed, once old, or once every step is done', () => {
    expect(firstWeekVisible({ groupCreatedAt: '2026-11-09T10:00:00Z', now, dismissed: true, steps })).toBe(false);
    const old = new Date(now.getTime() - (FIRST_WEEK_DAYS + 1) * 86_400_000).toISOString();
    expect(firstWeekVisible({ groupCreatedAt: old, now, dismissed: false, steps })).toBe(false);
    const done = steps.map((s) => ({ ...s, done: true }));
    expect(firstWeekVisible({ groupCreatedAt: '2026-11-09T10:00:00Z', now, dismissed: false, steps: done })).toBe(false);
    expect(firstWeekVisible({ groupCreatedAt: null, now, dismissed: false, steps })).toBe(false);
  });
});

describe('parseFirstWeekState', () => {
  it('reads what was stored and starts fresh on anything else', () => {
    expect(parseFirstWeekState('{"dismissed":true,"tapped":["bill",3]}')).toEqual({ dismissed: true, tapped: ['bill'] });
    expect(parseFirstWeekState('nope')).toEqual({ dismissed: false, tapped: [] });
    expect(parseFirstWeekState(null)).toEqual({ dismissed: false, tapped: [] });
  });
});
