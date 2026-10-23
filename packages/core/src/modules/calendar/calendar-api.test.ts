import { describe, expect, it, vi } from 'vitest';
import { createCalendarApi, type CalendarSend } from './calendar-api';

const reply = (ok: boolean, body: unknown) => ({ ok, json: async () => body });

describe('createCalendarApi', () => {
  it('reads the status, or null when the server did not answer', async () => {
    const send = vi.fn<CalendarSend>(async () => reply(true, { connected: 1 }));
    expect(await createCalendarApi(send).status()).toEqual({ connected: true });
    expect(send).toHaveBeenCalledWith('/api/calendar/status');
    send.mockResolvedValueOnce(reply(false, {}));
    expect(await createCalendarApi(send).status()).toBeNull();
  });

  it('asks for events in a range', async () => {
    const send = vi.fn<CalendarSend>(async () => reply(true, { events: [{ id: 'e1' }] }));
    const from = new Date('2026-10-18T00:00:00.000Z');
    const to = new Date('2026-10-25T00:00:00.000Z');
    expect(await createCalendarApi(send).events(from, to)).toEqual([{ id: 'e1' }]);
    expect(send).toHaveBeenCalledWith(
      '/api/calendar/events?from=2026-10-18T00%3A00%3A00.000Z&to=2026-10-25T00%3A00%3A00.000Z'
    );
    send.mockResolvedValueOnce(reply(true, {}));
    expect(await createCalendarApi(send).events(from, to)).toEqual([]);
    send.mockResolvedValueOnce(reply(false, {}));
    expect(await createCalendarApi(send).events(from, to)).toBeNull();
  });

  it('posts the actions and names an already imported event', async () => {
    const send = vi.fn<CalendarSend>(async () => reply(true, {}));
    const api = createCalendarApi(send);
    await api.share('e1');
    await api.unshare('e1');
    await api.dismiss('e1');
    await api.importAsTask('e1');
    expect(await api.importAsAppointment('e1', 'a1')).toEqual({ ok: true });
    expect(send.mock.calls).toEqual([
      ['/api/calendar/share', { method: 'POST', body: { eventId: 'e1' } }],
      ['/api/calendar/unshare', { method: 'POST', body: { eventId: 'e1' } }],
      ['/api/calendar/dismiss', { method: 'POST', body: { eventId: 'e1' } }],
      ['/api/calendar/import', { method: 'POST', body: { eventId: 'e1', target: 'task' } }],
      ['/api/calendar/import', { method: 'POST', body: { eventId: 'e1', target: 'appointment', apartmentId: 'a1' } }],
    ]);
    send.mockResolvedValueOnce(reply(false, { error: 'already_imported' }));
    expect(await api.importAsTask('e1')).toEqual({ ok: false, error: 'already_imported' });
    send.mockResolvedValueOnce({ ok: false, json: async () => Promise.reject(new Error('not json')) });
    expect(await api.dismiss('e1')).toEqual({ ok: false, error: 'unknown' });
  });
});
