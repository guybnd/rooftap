import { afterEach, describe, expect, it } from 'vitest';
import {
  RECENT_SECTIONS_KEY,
  initRecentSections,
  parseRecentSections,
  pickRecentSections,
  pushRecentSection,
  recordRecentSection,
  resetRecentSections,
} from './recent-sections';

describe('pushRecentSection', () => {
  it('moves the id to the front without duplicating it', () => {
    expect(pushRecentSection(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('returns the same array when the id already leads', () => {
    const ids = ['a', 'b'];
    expect(pushRecentSection(ids, 'a')).toBe(ids);
  });

  it('keeps at most ten', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    expect(pushRecentSection(ids, 'new')).toHaveLength(10);
  });
});

describe('parseRecentSections', () => {
  it('reads a stored list and drops junk', () => {
    expect(parseRecentSections('["a",1,"b"]')).toEqual(['a', 'b']);
    expect(parseRecentSections('{nope')).toEqual([]);
    expect(parseRecentSections(null)).toEqual([]);
    expect(parseRecentSections('{"a":1}')).toEqual([]);
  });
});

describe('pickRecentSections', () => {
  const visible = ['home', 'groceries', 'costs', 'calendar', 'recipes', 'shopper'].map((id) => ({ id }));

  it('skips excluded and no-longer-visible sections, in recency order', () => {
    const ids = ['groceries', 'documents', 'costs', 'calendar', 'recipes', 'shopper'];
    expect(pickRecentSections(ids, visible, new Set(['groceries'])).map((s) => s.id)).toEqual([
      'costs',
      'calendar',
      'recipes',
    ]);
  });

  it('returns fewer than three when that is all there is', () => {
    expect(pickRecentSections(['costs'], visible, new Set())).toEqual([{ id: 'costs' }]);
  });
});

describe('recent sections store', () => {
  afterEach(resetRecentSections);

  it('loads from storage and writes each change back', () => {
    const data = new Map<string, string>([[RECENT_SECTIONS_KEY, '["costs"]']]);
    initRecentSections({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) });
    recordRecentSection('calendar');
    expect(JSON.parse(data.get(RECENT_SECTIONS_KEY) ?? '[]')).toEqual(['calendar', 'costs']);
  });

  it('survives storage that throws', () => {
    initRecentSections({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => recordRecentSection('costs')).not.toThrow();
  });
});
