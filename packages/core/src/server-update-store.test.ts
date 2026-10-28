// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { loadServerUpdate, resetServerUpdate, useServerUpdate } from './server-update-store';

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
