// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { loadServerUpdate, refreshServerUpdate, resetServerUpdate, useServerUpdate, useServerUpdater } from './server-update-store';

const update = { current: '1.1.3', latest: '1.2.0', url: 'https://github.com/guybnd/rooftap/releases/tag/v1.2.0' };

beforeEach(() => resetServerUpdate());

describe('useServerUpdate', () => {
  it('asks once per person and shares the answer', async () => {
    const fetchUpdate = vi.fn(async () => ({ update }));
    const a = renderHook(() => useServerUpdate(fetchUpdate, 'u1'));
    const b = renderHook(() => useServerUpdate(fetchUpdate, 'u1'));
    await waitFor(() => expect(a.result.current).toEqual(update));
    expect(b.result.current).toEqual(update);
    expect(fetchUpdate).toHaveBeenCalledTimes(1);
  });

  it('asks nothing while nobody is signed in', async () => {
    const fetchUpdate = vi.fn(async () => ({ update }));
    const { result } = renderHook(() => useServerUpdate(fetchUpdate, null));
    expect(result.current).toBeUndefined();
    expect(fetchUpdate).not.toHaveBeenCalled();
  });

  it('asks again for another person, and after a failure', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await loadServerUpdate(failing, 'u1');
    await loadServerUpdate(failing, 'u1');
    expect(failing).toHaveBeenCalledTimes(2);

    const member = vi.fn(async (): Promise<unknown> => ({ update: null }));
    const { result, rerender } = renderHook(({ id, f }) => useServerUpdate(f, id), { initialProps: { id: 'u2', f: member } });
    await waitFor(() => expect(result.current).toBeNull());
    const admin = vi.fn(async (): Promise<unknown> => ({ update }));
    await act(async () => rerender({ id: 'u3', f: admin }));
    await waitFor(() => expect(result.current).toEqual(update));
  });
});

describe('useServerUpdater', () => {
  it('reads the updater from the same answer, and keeps it through a failed refresh', async () => {
    const updater = { installed: true, pending: false, pendingSince: null, status: null };
    let fail = false;
    const fetchUpdate = vi.fn(async () => {
      if (fail) throw new Error('restarting');
      return { update, updater };
    });
    const { result } = renderHook(() => useServerUpdater(fetchUpdate, 'u1'));
    await waitFor(() => expect(result.current).toEqual(updater));
    fail = true;
    await act(async () => refreshServerUpdate(fetchUpdate));
    expect(result.current).toEqual(updater);
  });

  it('is null from a server with no updater', async () => {
    const fetchUpdate = vi.fn(async () => ({ update }));
    const { result } = renderHook(() => useServerUpdater(fetchUpdate, 'u1'));
    await waitFor(() => expect(result.current).toBeNull());
  });
});
