import { describe, expect, it } from 'vitest';
import { buildDayRibbon, describeDayRibbon, skyHeadline, type WeatherData } from './weather-tips';

const base: WeatherData = { tempC: 18, weatherCode: 3, highC: 21, lowC: 12 };

function ahead(probs: number[], startHour = 13, temps?: number[]): WeatherData['ahead'] {
  const times = probs.map((_, i) => {
    const h = startHour + i;
    const day = h >= 24 ? '20' : '19';
    return `2026-10-${day}T${String(h % 24).padStart(2, '0')}:00`;
  });
  return { times, tempC: temps ?? probs.map((_, i) => 18 - i * 0.6), precipitationProbability: probs };
}

describe('buildDayRibbon', () => {
  it('returns no columns without an ahead series', () => {
    expect(buildDayRibbon(base)).toEqual([]);
  });

  it('labels Now then short hours, crossing midnight', () => {
    const cols = buildDayRibbon({ ...base, ahead: ahead([0, 0, 0, 0], 22) });
    expect(cols.map((c) => c.label)).toEqual(['Now', '11p', '12a', '1a']);
    expect(cols[0].isNow).toBe(true);
    expect(cols[2].key).toBe('2026-10-20T00');
  });

  it('marks likely rain, items and sunset by hour', () => {
    const cols = buildDayRibbon(
      { ...base, sunset: '2026-10-19T18:12', ahead: ahead([5, 10, 70, 49, 50, 0]) },
      ['2026-10-19T15:30', '2026-10-20T15:00'],
    );
    expect(cols.map((c) => c.rainLikely)).toEqual([false, false, true, false, true, false]);
    expect(cols.map((c) => c.hasItem)).toEqual([false, false, true, false, false, false]);
    expect(cols.findIndex((c) => c.isSunset)).toBe(5);
  });

  it('shows the temperature on every third column, rounded', () => {
    const cols = buildDayRibbon({ ...base, ahead: ahead([0, 0, 0, 0], 13, [17.6, 18, 18, 19.4]) });
    expect(cols.map((c) => (c.showTemp ? c.tempC : null))).toEqual([18, null, null, 19]);
  });
});

describe('skyHeadline', () => {
  const now = new Date(2026, 9, 19, 13, 10);
  it('says rain now when it is raining', () => {
    expect(skyHeadline({ ...base, weatherCode: 61 }, now)).toEqual({ text: 'Raining now', rain: true });
  });
  it('names the first likely rain hour ahead', () => {
    expect(skyHeadline({ ...base, ahead: ahead([0, 20, 60, 90]) }, now)).toEqual({ text: 'Rain at 3pm', rain: true });
  });
  it('falls back to the condition', () => {
    expect(skyHeadline({ ...base, ahead: ahead([0, 0]) }, now)).toEqual({ text: 'Overcast', rain: false });
  });
});

describe('describeDayRibbon', () => {
  it('names the first rain hour and sunset', () => {
    const cols = buildDayRibbon({ ...base, sunset: '2026-10-19T15:40', ahead: ahead([0, 70, 0]) });
    expect(describeDayRibbon(cols)).toBe('Next 3 hours, rain likely from 2p, sunset around 3p');
  });
});
