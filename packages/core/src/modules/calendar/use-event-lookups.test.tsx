// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEventLookups, eventForecastQuery, useEventTravelMinutes, useLegTravelMinutes } from './use-event-lookups';

const home = { home_lat: -37.8, home_lng: 144.9 };

describe('createEventLookups', () => {
  it('caches answers by query and drops failed ones', async () => {
    const get = vi.fn(async (path: string) => (path.includes('bad') ? null : { minutes: 14 }));
    const lookups = createEventLookups(get);
    expect(await lookups.travel('place=a')).toBe(14);
    expect(await lookups.travel('place=a')).toBe(14);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/event-travel?place=a');
    expect(await lookups.travel('place=bad')).toBeNull();
    await lookups.travel('place=bad');
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('reads a forecast, and treats a thrown request as no answer', async () => {
    const lookups = createEventLookups(async () => ({ forecast: { summary: 'Sunny' } }));
    expect(await lookups.forecast('date=2026-10-23')).toEqual({ summary: 'Sunny' });
    const failing = createEventLookups(async () => Promise.reject(new Error('offline')));
    expect(await failing.forecast('date=2026-10-23')).toBeNull();
  });
});

describe('eventForecastQuery', () => {
  it('asks nothing without an event', () => {
    expect(eventForecastQuery(null, home)).toBeNull();
  });
});

describe('useEventTravelMinutes', () => {
  it('needs a home, a mode and a place', async () => {
    const lookups = createEventLookups(async () => ({ minutes: 9 }));
    const noHome = renderHook(() => useEventTravelMinutes(lookups, 'Forum', 'drive', null, 0));
    expect(noHome.result.current).toEqual({ hasHome: false, minutes: undefined });

    const { result } = renderHook(() => useEventTravelMinutes(lookups, ' Forum ', 'walk', home, 0));
    await waitFor(() => expect(result.current.minutes).toBe(9));
    expect(result.current.hasHome).toBe(true);
  });

  it('asks with the trimmed place and the home', async () => {
    const get = vi.fn(async () => ({ minutes: 5 }));
    renderHook(() => useEventTravelMinutes(createEventLookups(get), ' Forum ', 'walk', home, 0));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/event-travel?place=Forum&mode=walk&from_lat=-37.8&from_lng=144.9'));
  });
});

describe('useLegTravelMinutes', () => {
  it('looks up a leg between two places', async () => {
    const get = vi.fn(async () => ({ minutes: 7 }));
    const { result } = renderHook(() =>
      useLegTravelMinutes(createEventLookups(get), { fromId: 'a', toId: 'b', from: 'Home', to: 'Cafe', mode: 'drive' } as never)
    );
    await waitFor(() => expect(result.current).toBe(7));
    expect(get).toHaveBeenCalledWith('/api/event-travel?place=Cafe&mode=drive&from=Home');
    await act(async () => {});
  });
});
