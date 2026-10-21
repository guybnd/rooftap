import { describe, expect, it } from 'vitest';
import {
  dailyLows,
  dealVerdict,
  isGoodNow,
  isWantStale,
  formatDistance,
  buildPlanToBuyTask,
  buildPlanToBuyCost,
  parsePriceInput,
  priceStats,
  pricePosition,
  sortOffers,
  summarizeWants,
  verdictCaption,
  wantQuery,
  DEAL_MIN_HISTORY_DAYS,
  type DailyPrice,
  type ShopperPriceSnapshot,
  type ShopperWant,
} from './shopper';
import {
  checkSourceManifest,
  checkSourceStores,
  checkSourceDeals,
  parseHttpSources,
  sourceCapabilityLabel,
  checkSourceOffers,
  cleanOfferUrl,
  isSourceApplicable,
  mergeSourceOffers,
  priceTextToCents,
} from './shopper-sources';

const TODAY = '2026-10-21';

function day(offset: number): string {
  const d = new Date(Date.UTC(2026, 9, 21 + offset));
  return d.toISOString().slice(0, 10);
}

/** `count` days of history ending yesterday, all at `cents`. */
function flat(cents: number, count = 30): DailyPrice[] {
  return Array.from({ length: count }, (_, i) => ({ day: day(i - count), cents }));
}

function want(overrides: Partial<ShopperWant> = {}): ShopperWant {
  return {
    id: 'w1',
    group_id: 'g1',
    title: 'Sony Bravia 7 65 inch',
    query: null,
    target_cents: null,
    budget_cents: null,
    status: 'watching',
    need_by: null,
    notes: null,
    best_cents: null,
    best_store: null,
    last_checked_at: null,
    bought_at: null,
    created_by: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    deleted: false,
    ...overrides,
  };
}

describe('price history', () => {
  it('keeps the cheapest store per day, oldest first', () => {
    const lows = dailyLows([
      { captured_on: '2026-10-02', price_cents: 900 },
      { captured_on: '2026-10-01', price_cents: 1000 },
      { captured_on: '2026-10-02', price_cents: 850 },
      { captured_on: '2026-10-01', price_cents: 0 },
    ]);
    expect(lows).toEqual([
      { day: '2026-10-01', cents: 1000 },
      { day: '2026-10-02', cents: 850 },
    ]);
  });

  it('takes the median of an even series as the mean of the middle two', () => {
    expect(priceStats([{ day: 'a', cents: 100 }, { day: 'b', cents: 300 }])).toEqual({ days: 2, low: 100, high: 300, median: 200 });
  });
});

describe('dealVerdict', () => {
  it('gives no rating until there are enough days of history', () => {
    const v = dealVerdict(100_00, flat(200_00, DEAL_MIN_HISTORY_DAYS - 1), TODAY);
    expect(v.rating).toBeNull();
    expect(v.underUsual).toBeCloseTo(0.5);
  });

  it('rates a new low as great', () => {
    const series = [...flat(2000_00), { day: TODAY, cents: 1999_00 }];
    expect(dealVerdict(1999_00, series, TODAY).rating).toBe('great');
  });

  it('rates 15% or more under the median as great', () => {
    const series = [...flat(2000_00, 20), ...flat(1500_00, 20).map((p, i) => ({ ...p, day: day(-41 - i) }))];
    // median 1750; 1480 is 15.4% under, but not under the 1500 low? it is: great either way
    expect(dealVerdict(1480_00, series, TODAY).rating).toBe('great');
  });

  it('rates 5 to 15% under as good, within 5% as fair, above as wait', () => {
    const series = [...flat(1000_00, 20), { day: day(-25), cents: 800_00 }];
    expect(dealVerdict(900_00, series, TODAY).rating).toBe('good');
    expect(dealVerdict(980_00, series, TODAY).rating).toBe('fair');
    expect(dealVerdict(1100_00, series, TODAY).rating).toBe('wait');
  });

  it('ignores history older than the 90-day window', () => {
    const old = flat(500_00, 20).map((p, i) => ({ ...p, day: day(-200 - i) }));
    const v = dealVerdict(1000_00, [...old, ...flat(1000_00, 20)], TODAY);
    expect(v.stats?.low).toBe(1000_00);
  });

  it('has no rating without a current price', () => {
    expect(dealVerdict(null, flat(100), TODAY).rating).toBeNull();
  });
});

describe('summaries and captions', () => {
  it('summarises each want from its own snapshots', () => {
    const snaps: ShopperPriceSnapshot[] = flat(1000_00, 20).map((p, i) => ({
      id: `s${i}`,
      group_id: 'g1',
      want_id: 'w1',
      source_id: 'test',
      store: 'JB Hi-Fi',
      price_cents: p.cents,
      currency: 'AUD',
      captured_on: p.day,
      created_at: '',
      updated_at: '',
      deleted: false,
    }));
    const [a, b] = summarizeWants([want({ best_cents: 800_00 }), want({ id: 'w2', best_cents: 800_00 })], snaps, TODAY);
    expect(a.verdict.rating).toBe('great');
    expect(a.trend.length).toBe(20);
    expect(b.verdict.rating).toBeNull();
    expect(isGoodNow(a)).toBe(true);
    expect(isGoodNow(b)).toBe(false);
  });

  it('counts a hit target as good now even without history', () => {
    const row = { want: want({ target_cents: 900_00, best_cents: 899_00 }), verdict: dealVerdict(899_00, [], TODAY), trend: [] };
    expect(isGoodNow(row)).toBe(true);
    expect(verdictCaption(row.verdict, row.want)).toBe('Hit target');
  });

  it('words the caption from the rating and the gap to usual', () => {
    const verdict = dealVerdict(1700_00, flat(2000_00), TODAY);
    expect(verdictCaption(verdict, want({ best_cents: 1700_00 }))).toBe('Great deal · 15% under usual');
    expect(verdictCaption(dealVerdict(null, [], TODAY), want())).toBe('Not checked yet');
    expect(verdictCaption(dealVerdict(500, [], TODAY), want({ best_cents: 500 }))).toBe('Not enough history');
  });

  it('places a price between the low and the high', () => {
    expect(pricePosition(150, { days: 3, low: 100, high: 200, median: 150 })).toBe(0.5);
    expect(pricePosition(50, { days: 3, low: 100, high: 200, median: 150 })).toBe(0);
    expect(pricePosition(50, { days: 1, low: 100, high: 100, median: 100 })).toBeNull();
  });
});

describe('wants', () => {
  it('searches the query when there is one, else the title', () => {
    expect(wantQuery({ title: 'New TV', query: ' Hisense U8 65 ' })).toBe('Hisense U8 65');
    expect(wantQuery({ title: 'New TV', query: '  ' })).toBe('New TV');
  });

  it('is stale after six hours, never once bought', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(isWantStale(want(), now)).toBe(true);
    expect(isWantStale(want({ last_checked_at: '2026-10-21T07:00:00Z' }), now)).toBe(false);
    expect(isWantStale(want({ last_checked_at: '2026-10-21T05:00:00Z' }), now)).toBe(true);
    expect(isWantStale(want({ status: 'bought' }), now)).toBe(false);
  });

  it('words distances for a meta line', () => {
    expect(formatDistance(3240)).toBe('3.2 km');
    expect(formatDistance(12_600)).toBe('13 km');
    expect(formatDistance(430)).toBe('400 m');
    expect(formatDistance(null)).toBeNull();
  });

  it('plans a purchase as a to-do and a one-off estimate', () => {
    const w = want({ need_by: '2026-10-25', best_cents: 1795_00 });
    const offer = { store: 'JB Hi-Fi', price_cents: 1795_00, url: 'https://jbhifi.com.au/p' };
    const task = buildPlanToBuyTask({ id: 't1', want: w, offer, priceLabel: '$1,795' });
    expect(task).toMatchObject({ title: 'Buy Sony Bravia 7 65 inch at JB Hi-Fi', due_date: '2026-10-25', notes: '$1,795\nhttps://jbhifi.com.au/p' });
    const cost = buildPlanToBuyCost({ id: 'c1', want: w, offer });
    expect(cost).toMatchObject({ amount: 1795_00, cadence: 'one_off', category: 'purchase', is_estimate: true, provider: 'JB Hi-Fi', start_date: '2026-10-25' });
  });

  it('parses typed prices into cents', () => {
    expect(parsePriceInput('$1,799.95')).toBe(179995);
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('free')).toBeNull();
  });

  it('sorts offers cheapest first, in stock before unknown at the same price', () => {
    const sorted = sortOffers([
      { store: 'B', price_cents: 100, in_stock: null, distance_m: null },
      { store: 'A', price_cents: 100, in_stock: true, distance_m: 5000 },
      { store: 'C', price_cents: 90, in_stock: false, distance_m: null },
    ]);
    expect(sorted.map((o) => o.store)).toEqual(['C', 'A', 'B']);
  });
});

describe('sources', () => {
  const manifest = { id: 'serp', regions: ['AU', 'NZ'] as const, env: ['SERPAPI_API_KEY'] };

  it('applies when the region, keys and switches all allow it', () => {
    const keys = new Set(['SERPAPI_API_KEY']);
    expect(isSourceApplicable(manifest, { region: 'au', configuredKeys: keys })).toBe(true);
    expect(isSourceApplicable(manifest, { region: 'GB', configuredKeys: keys })).toBe(false);
    expect(isSourceApplicable(manifest, { region: 'AU', configuredKeys: new Set() })).toBe(false);
    expect(isSourceApplicable(manifest, { region: 'AU', configuredKeys: keys, disabledByServer: new Set(['serp']) })).toBe(false);
    expect(isSourceApplicable({ ...manifest, regions: '*' }, { region: 'IL', configuredKeys: keys })).toBe(true);
  });

  it('keeps the cheapest offer per store across sources', () => {
    const merged = mergeSourceOffers([
      { store: 'JB Hi-Fi', price_cents: 1795_00 },
      { store: 'JB HI-FI ', price_cents: 1749_00 },
      { store: 'Amazon AU', price_cents: 1899_00 },
    ]);
    expect(merged).toEqual([
      { store: 'JB HI-FI ', price_cents: 1749_00 },
      { store: 'Amazon AU', price_cents: 1899_00 },
    ]);
  });

  it('flags offers that break the contract', () => {
    const ok = { store: 'JB Hi-Fi', title: 'TV', url: 'https://jbhifi.com.au/tv', price_cents: 100, currency: 'AUD', in_stock: true };
    expect(checkSourceOffers([ok], { currency: 'AUD' })).toEqual([]);
    expect(checkSourceOffers([{ ...ok, currency: 'USD' }], { currency: 'AUD' })).toHaveLength(1);
    expect(checkSourceOffers([{ ...ok, price_cents: 1.5 }], { currency: 'AUD' })).toHaveLength(1);
    expect(checkSourceOffers([{ ...ok, url: 'https://x.com/p?utm_source=a' }], { currency: 'AUD' })).toHaveLength(1);
  });

  it('strips tracking parameters and refuses non-https links', () => {
    expect(cleanOfferUrl('https://shop.example/p?id=1&utm_source=g&gclid=x')).toBe('https://shop.example/p?id=1');
    expect(cleanOfferUrl('http://shop.example/p')).toBeNull();
    expect(cleanOfferUrl('not a url')).toBeNull();
  });

  it('reads price text into cents', () => {
    expect(priceTextToCents('$1,799.00')).toBe(179900);
    expect(priceTextToCents('A$ 899')).toBe(89900);
    expect(priceTextToCents(12.5)).toBe(1250);
    expect(priceTextToCents('call us')).toBeNull();
  });
});

describe('source manifest and external sources (HOUP-437)', () => {
  const good = {
    id: 'pricespy-nz',
    name: 'PriceSpy',
    regions: ['NZ'],
    capabilities: ['offers'],
    kind: 'api',
    env: [],
    attribution: 'Prices from PriceSpy',
    homepage: 'https://pricespy.co.nz',
    ratePerMinute: 30,
  } as const;

  it('passes a sound manifest and names what is wrong with a bad one', () => {
    expect(checkSourceManifest({ ...good })).toEqual([]);
    const problems = checkSourceManifest({ ...good, id: 'Manual Prices', regions: ['nz'], attribution: ' ', kind: 'page', ratePerMinute: 60 });
    expect(problems.join('\n')).toMatch(/kebab-case/);
    expect(problems.join('\n')).toMatch(/regions/);
    expect(problems.join('\n')).toMatch(/attribution/);
    expect(problems.join('\n')).toMatch(/page source/);
  });

  it('reads SHOPPER_HTTP_SOURCES, keeping good entries and reporting bad ones', () => {
    const raw = JSON.stringify([
      { url: 'https://prices.example.nz/api/', token: 'abc', manifest: { ...good, regions: ['nz'] } },
      { url: 'ftp://nope', manifest: good },
      { url: 'https://two.example', manifest: { ...good } },
      { url: 'https://three.example', manifest: { id: 'x' } },
    ]);
    const { sources, problems } = parseHttpSources(raw);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ url: 'https://prices.example.nz/api', token: 'abc' });
    expect(sources[0].manifest.regions).toEqual(['NZ']);
    expect(problems.some((p) => p.startsWith('entry 1'))).toBe(true);
    expect(problems.some((p) => p.includes('listed twice'))).toBe(true);
    expect(problems.some((p) => p.startsWith('entry 3'))).toBe(true);
    expect(parseHttpSources('not json').problems).toEqual(['SHOPPER_HTTP_SOURCES is not valid JSON']);
    expect(parseHttpSources(undefined)).toEqual({ sources: [], problems: [] });
  });

  it('checks stores and deals', () => {
    expect(checkSourceStores([{ name: 'JB', lat: -37.9, lng: 145, address: null, hours: null }])).toEqual([]);
    expect(checkSourceStores([{ name: '', lat: 200, lng: 0, address: null, hours: null }])).toHaveLength(2);
    expect(checkSourceDeals([{ title: 'TV', url: 'https://x.example/1', price_cents: 100, currency: 'AUD', posted_at: null }])).toEqual([]);
    expect(checkSourceDeals([{ title: 'TV', url: 'http://x', price_cents: 1.5, currency: null, posted_at: 'soon' }])).toHaveLength(3);
  });

  it('words what a source gives', () => {
    expect(sourceCapabilityLabel(['offers'])).toBe('Prices');
    expect(sourceCapabilityLabel(['offers', 'stores', 'deals'])).toBe('Prices, nearby stores and shared deals');
    expect(sourceCapabilityLabel([])).toBe('');
  });
});
