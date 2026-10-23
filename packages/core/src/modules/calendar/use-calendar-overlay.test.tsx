// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GoogleCalendarEventWithAttribution } from '../../types';
import type { CalendarApi } from './calendar-api';
import { useCalendarOverlay } from './use-calendar-overlay';

const gcal = (id: string, extra: Partial<GoogleCalendarEventWithAttribution> = {}) =>
  ({ id, title: id, visibility: 'private', state: 'active', ...extra }) as GoogleCalendarEventWithAttribution;

function fakeApi(overrides: Partial<Record<keyof CalendarApi, unknown>> = {}) {
  return {
    status: vi.fn(async () => ({ connected: true })),
    events: vi.fn(async () => [gcal('e1'), gcal('s1', { state: 'suggested' })]),
    dismiss: vi.fn(async () => ({ ok: true })),
    importAsTask: vi.fn(async () => ({ ok: true })),
    importAsAppointment: vi.fn(async () => ({ ok: true })),
    share: vi.fn(async () => ({ ok: true })),
    unshare: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as unknown as CalendarApi;
}

const from = new Date(2026, 9, 18);
const to = new Date(2026, 9, 25);

function setup(api: CalendarApi, options: Partial<Parameters<typeof useCalendarOverlay>[0]> = {}) {
  const notifyError = vi.fn();
  const onImported = vi.fn();
  const onClosed = vi.fn();
  const hook = renderHook(() =>
    useCalendarOverlay({ api, enabled: true, showViewings: true, from: new Date(from), to: new Date(to), notifyError, onImported, onClosed, ...options })
  );
  return { ...hook, notifyError, onImported, onClosed };
}

describe('useCalendarOverlay', () => {
  it('loads the range once and shows suggestions as plain events without viewings', async () => {
    const api = fakeApi();
    const { result, rerender } = setup(api, { showViewings: false });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.events.map((e) => e.state)).toEqual(['active', 'synced']);
    rerender();
    expect(api.events).toHaveBeenCalledTimes(1);
    expect(api.events).toHaveBeenCalledWith(from, to);
  });

  it('fetches nothing while off, and clears when not connected', async () => {
    const off = fakeApi();
    const first = setup(off, { enabled: false });
    await act(async () => {});
    expect(off.status).not.toHaveBeenCalled();
    expect(first.result.current.events).toEqual([]);

    const disconnected = fakeApi({ status: vi.fn(async () => ({ connected: false })) });
    const second = setup(disconnected);
    await act(async () => {});
    expect(second.result.current.connected).toBe(false);
    expect(disconnected.events).not.toHaveBeenCalled();
  });

  it('keeps what is shown when the server does not answer', async () => {
    const api = fakeApi();
    const { result } = setup(api);
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    vi.mocked(api.status).mockResolvedValueOnce(null);
    await act(() => result.current.refresh());
    expect(result.current.connected).toBe(true);
    expect(result.current.events).toHaveLength(2);
    vi.mocked(api.events).mockResolvedValueOnce(null);
    await act(() => result.current.refresh());
    expect(result.current.events).toHaveLength(2);
  });

  it('toggles sharing on the selected event', async () => {
    const api = fakeApi();
    const { result } = setup(api);
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() => result.current.setSelected(gcal('e1')));
    await act(() => result.current.toggleShare());
    expect(api.share).toHaveBeenCalledWith('e1');
    expect(result.current.selected?.visibility).toBe('group');
    await act(() => result.current.toggleShare());
    expect(api.unshare).toHaveBeenCalledWith('e1');
    expect(result.current.selected?.visibility).toBe('private');
    expect(result.current.busy).toBe(false);
  });

  it('closes after a dismiss or an import, and toasts a failed import', async () => {
    const api = fakeApi();
    const { result, onClosed, onImported, notifyError } = setup(api);
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => result.current.setSelected(gcal('e1')));
    await act(() => result.current.dismiss());
    expect(api.dismiss).toHaveBeenCalledWith('e1');
    expect(result.current.selected).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);

    act(() => result.current.setSelected(gcal('e1')));
    await act(() => result.current.importAsAppointment('a1'));
    expect(api.importAsAppointment).toHaveBeenCalledWith('e1', 'a1');
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(2);

    act(() => result.current.setSelected(gcal('e1')));
    vi.mocked(api.importAsTask).mockResolvedValueOnce({ ok: false, error: 'already_imported' });
    await act(() => result.current.importAsTask());
    expect(notifyError).toHaveBeenCalledWith('This event has already been imported.');
    vi.mocked(api.importAsTask).mockResolvedValueOnce({ ok: false, error: 'unknown' });
    await act(() => result.current.importAsTask());
    expect(notifyError).toHaveBeenLastCalledWith('Could not add as to-do. Please try again.');
    expect(result.current.selected?.id).toBe('e1');
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('does nothing with no event selected', async () => {
    const api = fakeApi();
    const { result } = setup(api);
    await act(() => result.current.dismiss());
    expect(api.dismiss).not.toHaveBeenCalled();
  });
});
