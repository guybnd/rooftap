import { describe, expect, it } from 'vitest';
import type { CostItem } from '../types';
import type { HeroItem } from '../hero';
import type { WeatherData } from '../weather-tips';
import { ALL_MODULE_IDS, type ModuleId } from '../modules';
import { isFeatureEnabled, type ModuleFeatureId } from '../module-features';
import {
  HERO_GROUP_ORDER,
  HERO_MODULES,
  availableHeroModules,
  budgetPulseTone,
  coarseCountdown,
  heroTip,
  heroTips,
  isCountdownDueSoon,
  isModuleEnabled,
  isModuleShown,
  nextUpItem,
  unassignedCount,
  upcomingBills,
  whosOnHookBuckets,
} from './hero-modules';

const DATE = '2026-07-23';
const NOON = new Date(`${DATE}T12:00:00`);

function item(overrides: Partial<HeroItem> = {}): HeroItem {
  return {
    id: overrides.id ?? 'i1',
    type: 'task',
    ownerSection: 'household',
    title: 'Bins',
    dueDate: DATE,
    dueTime: null,
    overdue: false,
    done: false,
    assignedTo: null,
    sourceLabel: 'Task',
    ...overrides,
  };
}

function cost(over: Partial<CostItem> = {}): CostItem {
  return {
    id: 'c',
    group_id: 'g',
    name: 'Line',
    category: 'other',
    amount: 1_000,
    cadence: 'one_off',
    is_estimate: false,
    start_date: null,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: null,
    notes: null,
    sort_order: 0,
    created_by: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    deleted: false,
    ...over,
  } as CostItem;
}

const hours = () => Array.from({ length: 24 }, (_, h) => `${DATE}T${String(h).padStart(2, '0')}:00`);

function weather(overrides: Partial<WeatherData> = {}): WeatherData {
  return { tempC: 20, weatherCode: 1, highC: 24, lowC: 14, ...overrides };
}

describe('HERO_MODULES registry', () => {
  it('keeps the frozen keys in render order', () => {
    expect(HERO_MODULES.map((m) => m.key)).toEqual([
      'weather',
      'count',
      'nextUp',
      'whosOnHook',
      'unassignedNudge',
      'streak',
      'tipRain',
      'tipUv',
      'tipDrying',
      'tipSunset',
      'budgetPulse',
      'billsDue',
      'shoppingList',
      'shopperWatch',
      'setupProgress',
      'countdown',
      'spaceBudget',
      'spaceBills',
    ]);
  });

  it('registers countdown in the home group, off by default', () => {
    const countdown = HERO_MODULES.find((m) => m.key === 'countdown');
    expect(countdown?.group).toBe('home');
    expect(countdown?.defaultOn).toBe(false);
  });

  it('lists every group the registry uses', () => {
    expect(new Set(HERO_MODULES.map((m) => m.group))).toEqual(new Set(HERO_GROUP_ORDER));
  });

  it('a saved toggle wins over the default, and an unknown key is on', () => {
    expect(isModuleEnabled('countdown', null)).toBe(false);
    expect(isModuleEnabled('countdown', { countdown: true })).toBe(true);
    expect(isModuleEnabled('weather', { weather: false })).toBe(false);
    expect(isModuleEnabled('someday', {})).toBe(true);
  });
});

// A hero module showing another module's data is gone with that module, from
// the hero and from the customize sheet, even when the saved config has it on.
describe('hero modules behind a module', () => {
  const ALL_KEYS = HERO_MODULES.map((m) => m.key);
  const allOnConfig = Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
  const featureWith = (enabled: ReadonlySet<string>) => (id: ModuleFeatureId) => isFeatureEnabled(id, enabled);

  const goneWithout: Partial<Record<ModuleId, string[]>> = {
    household: ['whosOnHook', 'unassignedNudge', 'streak'],
    costs: ['budgetPulse', 'billsDue', 'spaceBudget', 'spaceBills'],
    groceries: ['shoppingList'],
    setup: ['setupProgress'],
    shopper: ['shopperWatch'],
  };

  it('everything on lists and shows every module', () => {
    const feature = featureWith(new Set(ALL_MODULE_IDS));
    expect(availableHeroModules(feature).map((m) => m.key)).toEqual(ALL_KEYS);
    expect(ALL_KEYS.filter((k) => isModuleShown(k, allOnConfig, feature))).toEqual(ALL_KEYS);
  });

  it.each(ALL_MODULE_IDS)('turning %s off removes only its modules, whatever the config says', (off) => {
    const feature = featureWith(new Set(ALL_MODULE_IDS.filter((m) => m !== off)));
    const expected = ALL_KEYS.filter((k) => !(goneWithout[off] ?? []).includes(k));
    expect(availableHeroModules(feature).map((m) => m.key)).toEqual(expected);
    expect(ALL_KEYS.filter((k) => isModuleShown(k, allOnConfig, feature))).toEqual(expected);
  });

  it("the person's own off toggle still hides a module whose feature is on", () => {
    const feature = featureWith(new Set(ALL_MODULE_IDS));
    expect(isModuleShown('budgetPulse', { budgetPulse: false }, feature)).toBe(false);
  });

  it('filters an app registry with extra fields the same way', () => {
    const feature = featureWith(new Set(ALL_MODULE_IDS.filter((m) => m !== 'costs')));
    const withRender = HERO_MODULES.map((m) => ({ ...m, render: () => m.key }));
    const listed = availableHeroModules(feature, withRender);
    expect(listed.map((m) => m.key)).not.toContain('budgetPulse');
    expect(listed[0].render()).toBe('weather');
  });
});

describe("today's lines", () => {
  it('coarseCountdown rounds to minutes under the hour and hours after', () => {
    expect(coarseCountdown(NOON, '11:30')).toBe('now');
    expect(coarseCountdown(NOON, '12:00')).toBe('now');
    expect(coarseCountdown(NOON, '12:25')).toBe('in 25m');
    expect(coarseCountdown(NOON, '14:40')).toBe('in 3h');
  });

  it('isCountdownDueSoon is true only within the hour', () => {
    expect(isCountdownDueSoon('now')).toBe(true);
    expect(isCountdownDueSoon('in 25m')).toBe(true);
    expect(isCountdownDueSoon('in 3h')).toBe(false);
  });

  it('nextUpItem is the soonest open timed item', () => {
    const items = [
      item({ id: 'a', dueTime: '15:00' }),
      item({ id: 'b', dueTime: '09:00', done: true }),
      item({ id: 'c', dueTime: '13:00' }),
      item({ id: 'd' }),
    ];
    expect(nextUpItem(items)?.id).toBe('c');
    expect(nextUpItem([item()])).toBeNull();
  });

  it("splits today's open tasks and reminders by assignee, current user first, then by name", () => {
    const profiles = {
      me: { email: 'me@x', name: 'Zed', avatar: null },
      amy: { email: 'amy@x', name: 'Amy', avatar: null },
      bo: { email: 'bo@x', name: 'Bo', avatar: null },
    };
    const items = [
      item({ id: '1', assignedTo: 'bo' }),
      item({ id: '2', assignedTo: 'amy', type: 'reminder' }),
      item({ id: '3', assignedTo: 'me' }),
      item({ id: '4', assignedTo: 'bo' }),
      item({ id: '5', assignedTo: 'amy', type: 'appointment' }),
      item({ id: '6', assignedTo: 'amy', done: true }),
      item({ id: '7', assignedTo: null }),
    ];
    const { assigneeIds, countFor } = whosOnHookBuckets(items, 'me', profiles);
    expect(assigneeIds).toEqual(['me', 'amy', 'bo']);
    expect([countFor('me'), countFor('amy'), countFor('bo'), countFor('nobody')]).toEqual([1, 1, 2, 0]);
    expect(unassignedCount(items)).toBe(1);
  });
});

describe('smart tips', () => {
  const allOn = () => true;

  it('shows the first two qualifying tips in registry order', () => {
    const w = weather({
      tempC: 30,
      humidity: 45,
      windSpeedKmh: 15,
      sunset: `${DATE}T19:42`,
      hourly: {
        times: hours(),
        precipitation: hours().map(() => 0),
        precipitationProbability: hours().map(() => 0),
        uvIndex: hours().map((_, h) => (h === 12 ? 8 : 0)),
      },
    });
    expect(heroTips(w, NOON, allOn).map((t) => t.key)).toEqual(['tipRain', 'tipUv']);
    expect(heroTips(w, NOON, allOn, 4).map((t) => t.key)).toEqual(['tipRain', 'tipUv', 'tipDrying', 'tipSunset']);
  });

  it("a tip with nothing to say doesn't take a slot from a lower one", () => {
    const w = weather({
      humidity: 45,
      windSpeedKmh: 15,
      uvIndexMax: 2,
      hourly: {
        times: hours(),
        precipitation: hours().map(() => 0),
        precipitationProbability: hours().map(() => 0),
        uvIndex: hours().map(() => 0),
      },
    });
    expect(heroTips(w, NOON, allOn).map((t) => t.key)).toEqual(['tipDrying']);
  });

  it('skips tips that are off, and has none without weather', () => {
    const w = weather({ tempC: 30, uvIndexMax: 9 });
    expect(heroTips(w, NOON, (k) => k !== 'tipRain').map((t) => t.key)).toEqual(['tipUv']);
    expect(heroTips(null, NOON, allOn)).toEqual([]);
  });

  it('gives each tip its line and glyph', () => {
    expect(heroTip('tipRain', weather({ weatherCode: 61 }), NOON)).toEqual({
      key: 'tipRain',
      text: 'Rain expected, bring an umbrella',
      glyph: 'rain',
    });
    expect(heroTip('tipUv', weather({ uvIndexMax: 9 }), NOON)).toEqual({ key: 'tipUv', text: 'UV is high, wear sunscreen', glyph: 'uv' });
    expect(heroTip('tipSunset', weather({ sunset: `${DATE}T19:42` }), NOON)).toEqual({
      key: 'tipSunset',
      text: 'Sunset 7:42 PM · golden hour 7:05 PM',
      glyph: 'sunset',
    });
    expect(heroTip('weather', weather(), NOON)).toBeNull();
  });
});

describe('shortcuts', () => {
  it('budgetPulseTone is danger from 100% spent and warning from 80%', () => {
    expect(budgetPulseTone(15_000, 15_000)).toBe('danger');
    expect(budgetPulseTone(15_000, 20_000)).toBe('danger');
    expect(budgetPulseTone(15_000, 12_000)).toBe('warning');
    expect(budgetPulseTone(15_000, 14_000)).toBe('warning');
    expect(budgetPulseTone(15_000, 5_000)).toBe('success');
  });

  it('upcomingBills lists bills and ending discounts within a week, soonest first', () => {
    const now = new Date('2026-07-23T12:00:00');
    const bills = upcomingBills(
      [
        cost({ id: 'later', name: 'Later', start_date: '2026-07-30' }),
        cost({ id: 'soon', name: 'Soon', provider: 'Power Co', start_date: '2026-07-25' }),
        cost({ id: 'far', name: 'Far', start_date: '2026-08-20' }),
        cost({ id: 'promo', name: 'Promo', cadence: 'monthly', category: 'internet', discount_end_date: '2026-07-24' }),
      ],
      now
    );
    expect(bills.map((b) => [b.key, b.label, b.days, b.discountEnding])).toEqual(
      expect.arrayContaining([
        ['promo-discount', 'Promo', 1, true],
        ['soon-due', 'Power Co', 2, false],
        ['later-due', 'Later', 7, false],
      ])
    );
    expect(bills.map((b) => b.key)).not.toContain('far-due');
    const days = bills.map((b) => b.days);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });
});
