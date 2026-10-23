// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BinStream, ParsedBinSetup } from './bins';
import type { BinsApi } from './use-bins';
import { useBinSetup } from './use-bins-view';

const WED = '2026-10-28';

function stream(over: Partial<BinStream> & Pick<BinStream, 'id' | 'name'>): BinStream {
  return {
    group_id: 'g',
    lid: 'red',
    weekday: 3,
    every_weeks: 1,
    anchor_date: WED,
    sort_order: 0,
    created_by: null,
    created_at: '',
    updated_at: '',
    deleted: false,
    ...over,
  };
}

function fakeBins(streams: BinStream[] = []): BinsApi {
  return {
    loaded: true,
    streams,
    changes: [],
    plan: null,
    night: { collection: null, nightOf: null, tonight: false, out: false, turn: null },
    heroItem: null,
    savePlan: vi.fn(),
    saveSetup: vi.fn(),
    markOut: vi.fn(),
    undoOut: vi.fn(),
    swapTurn: vi.fn(),
    removeChange: vi.fn(),
  } as unknown as BinsApi;
}

const noHa = vi.fn(async () => ({ ok: false as const, error: 'off' }));

describe('useBinSetup', () => {
  it('starts with one bin and refuses to save it unnamed', () => {
    const bins = fakeBins();
    const { result } = renderHook(() => useBinSetup({ bins, today: WED, readHomeAssistantBins: noHa }));
    expect(result.current.streams).toHaveLength(1);
    act(() => result.current.updateStream(result.current.streams[0].key, { name: ' ' }));
    let ok = true;
    act(() => {
      ok = result.current.submit();
    });
    expect(ok).toBe(false);
    expect(result.current.tried).toBe(true);
    expect(bins.saveSetup).not.toHaveBeenCalled();
  });

  it('adds a fortnightly bin with a free lid, and removing a bin drops its changes', () => {
    const { result } = renderHook(() => useBinSetup({ bins: fakeBins([stream({ id: 'r', name: 'Red' })]), today: WED, readHomeAssistantBins: noHa }));
    act(() => result.current.addStream());
    const added = result.current.streams[1];
    expect(added).toMatchObject({ lid: 'yellow', every_weeks: 2 });
    act(() => result.current.addChange({ streamKey: added.key, on_date: WED, moved_to: null, note: null }));
    expect(result.current.changes).toHaveLength(1);
    act(() => result.current.removeStream(added.key));
    expect(result.current.streams).toHaveLength(1);
    expect(result.current.changes).toHaveLength(0);
  });

  it('fills the drafts from a council read, keeping saved ids by name', async () => {
    const saved = stream({ id: 'r', name: 'Red' });
    const setup: ParsedBinSetup = {
      streams: [
        { key: 'p1', name: 'red', lid: 'red', weekday: 3, every_weeks: 1, anchor_date: WED },
        { key: 'p2', name: 'Green', lid: 'green', weekday: 3, every_weeks: 2, anchor_date: WED },
      ],
      changes: [{ key: 'c1', streamKey: 'p2', on_date: WED, moved_to: null, note: null }],
    } as ParsedBinSetup;
    const { result } = renderHook(() => useBinSetup({ bins: fakeBins([saved]), today: WED, readHomeAssistantBins: noHa }));
    await act(() => result.current.readCouncil(async () => ({ ok: true, setup })));
    expect(result.current.method).toBe('council');
    expect(result.current.streams[0].id).toBe('r');
    expect(result.current.changes[0].streamKey).toBe(result.current.streams[1].key);
    expect(result.current.readNote).toBe('Found 2 bins and 1 change. Check them below, then save.');
  });

  it('does nothing when the picker was cancelled, and shows read errors', async () => {
    const { result } = renderHook(() => useBinSetup({ bins: fakeBins(), today: WED, readHomeAssistantBins: noHa }));
    await act(() => result.current.readCouncil(async () => null));
    expect(result.current.readError).toBeNull();
    expect(result.current.reading).toBe(false);
    await act(() => result.current.readHomeAssistant());
    expect(result.current.readError).toBe('off');
  });

  it('saves the rotation with a fresh anchor when the first person changes', () => {
    const bins = fakeBins([stream({ id: 'r', name: 'Red' })]);
    const { result } = renderHook(() => useBinSetup({ bins, today: WED, readHomeAssistantBins: noHa }));
    act(() => {
      result.current.toggleMember('u1');
      result.current.toggleMember('u2');
      result.current.setPushOn(false);
    });
    act(() => {
      result.current.submit();
    });
    expect(bins.saveSetup).toHaveBeenCalledWith(expect.objectContaining({ rotation: ['u1', 'u2'], rotationAnchor: WED, pushAt: null, source: 'manual' }));
  });
});
