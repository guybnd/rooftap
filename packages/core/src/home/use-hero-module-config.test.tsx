// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeroModuleConfig, type HeroModuleConfigSource } from './use-hero-module-config';

// The hook's own debounce and reconciliation, with the data cache slice and
// the Supabase client faked.

const upsert = vi.fn(async (_payload: Record<string, unknown>, _opts?: Record<string, unknown>) => ({ data: null, error: null }));
const getClient = () => ({ from: () => ({ upsert }) }) as unknown as SupabaseClient;

let source: HeroModuleConfigSource;

function render() {
  return renderHook(() => useHeroModuleConfig(source, getClient));
}

describe('useHeroModuleConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    source = {
      userSettings: { home_hero_modules: {}, home_hero_countdown: null },
      currentUserId: 'user-1',
      refresh: vi.fn(async () => undefined),
    };
    upsert.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a toggle at once and keeps it while the write is in flight', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.setModule('streak', true);
    });
    expect(result.current.config).toEqual({ streak: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ user_id: 'user-1', home_hero_modules: { streak: true } });
    expect(source.refresh).toHaveBeenCalledTimes(1);
  });

  it('builds each toggle on the latest one, even before a re-render', async () => {
    const { result } = render();
    await act(async () => {
      await Promise.all([result.current.setModule('streak', true), result.current.setModule('tipDrying', true)]);
    });
    expect(upsert.mock.calls[1][0]).toMatchObject({ home_hero_modules: { streak: true, tipDrying: true } });
  });

  it('does not clobber an optimistic countdown with a remote change mid-debounce, and reconciles once the write settles', async () => {
    const { result, rerender } = render();

    act(() => {
      result.current.setCountdown({ label: 'Trip', date: '2026-08-01' });
    });
    expect(result.current.countdown).toEqual({ label: 'Trip', date: '2026-08-01' });

    source = { ...source, userSettings: { home_hero_modules: {}, home_hero_countdown: null } };
    rerender();
    expect(result.current.countdown).toEqual({ label: 'Trip', date: '2026-08-01' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(source.refresh).toHaveBeenCalledTimes(1);

    source = { ...source, userSettings: { home_hero_modules: {}, home_hero_countdown: { label: 'Trip', date: '2026-08-01' } } };
    rerender();
    expect(result.current.countdown).toEqual({ label: 'Trip', date: '2026-08-01' });
  });

  it('does not write when no user is signed in', async () => {
    source = { ...source, currentUserId: null };
    const { result } = render();
    act(() => {
      result.current.setCountdown({ label: 'Trip', date: '2026-08-01' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await result.current.setModule('streak', true);
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('writes once the user becomes known, though the gate was built with no user', async () => {
    source = { ...source, currentUserId: null };
    const { result, rerender } = render();
    source = { ...source, currentUserId: 'user-1' };
    rerender();

    act(() => {
      result.current.setCountdown({ label: 'Trip', date: '2026-08-01' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({ user_id: 'user-1', home_hero_countdown: { label: 'Trip', date: '2026-08-01' } });
  });
});
