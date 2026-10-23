import { describe, expect, it, vi } from 'vitest';
import type { BinChange, BinCollection, BinNightState, BinStream } from './bins';
import {
  binChangeDraftDetail,
  binChangeMeta,
  binChangeTitle,
  binCollectionMeta,
  binCollectionWhen,
  binReadNote,
  binStripDays,
  binTurnCaption,
  binsLede,
  comingBinChanges,
  createBinsSetupApi,
  nextFreeBinLid,
} from './bins-view';

// 2026-10-28 is a Wednesday.
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

function change(over: Partial<BinChange> & Pick<BinChange, 'id' | 'on_date'>): BinChange {
  return {
    group_id: 'g',
    stream_id: null,
    moved_to: null,
    note: null,
    source: 'manual',
    created_by: null,
    created_at: '',
    updated_at: '',
    deleted: false,
    ...over,
  };
}

const red = stream({ id: 'r', name: 'Red' });
const nameOf = (id: string | null) => (id === 'u2' ? 'Sam' : 'Member');

describe('binsLede', () => {
  const collection: BinCollection = { date: WED, streams: [red], moved: [], notes: [] };
  const night = (over: Partial<BinNightState> = {}): BinNightState => ({ collection, nightOf: '2026-10-27', tonight: false, out: false, turn: null, ...over });
  const caption = (id: string | null) => binTurnCaption(id, 'u1', nameOf);

  it('shows the empty prompt with no bins', () => {
    expect(binsLede(night({ collection: null }), WED, caption)).toEqual({
      value: 'No bins',
      caption: 'Add your bin days to get a reminder the night before',
    });
  });

  it('names what goes out and whose turn it is', () => {
    expect(binsLede(night({ tonight: true, turn: 'u2' }), '2026-10-27', caption).caption).toBe("Out tonight: red · Sam's turn");
    expect(binsLede(night({ turn: 'u1' }), '2026-10-25', caption).caption).toBe('Red · your turn');
  });
});

describe('screen helpers', () => {
  it('lays out two weeks with their collections', () => {
    const days = binStripDays([red], [], '2026-10-26');
    expect(days).toHaveLength(2);
    expect(days[0]).toHaveLength(7);
    const withBins = days.flat().filter((d) => d.collection);
    expect(withBins.map((d) => d.date)).toEqual([WED, '2026-11-04']);
  });

  it('keeps changes that still matter, soonest first', () => {
    const old = change({ id: 'a', on_date: '2026-10-01' });
    const movedAhead = change({ id: 'b', on_date: '2026-10-20', moved_to: '2026-10-30' });
    const soon = change({ id: 'c', on_date: '2026-10-29' });
    expect(comingBinChanges([soon, old, movedAhead], WED).map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('titles and describes a change', () => {
    const names = new Map([['r', 'Red']]);
    expect(binChangeTitle(change({ id: 'a', on_date: WED, stream_id: 'r' }), names)).toMatch(/ · Red$/);
    expect(binChangeTitle(change({ id: 'a', on_date: WED }), names)).toMatch(/ · Every bin$/);
    expect(binChangeMeta(change({ id: 'a', on_date: WED, note: 'Public holiday' }))).toMatch(/ · Public holiday$/);
  });

  it('describes a coming collection', () => {
    const c: BinCollection = { date: WED, streams: [red], moved: [{ streamId: 'r', from: '2026-10-27' }], notes: ['Holiday'] };
    expect(binCollectionMeta(c, 'u2', (id) => nameOf(id))).toMatch(/^Sam · moved from .* · Holiday$/);
    expect(binCollectionMeta({ ...c, moved: [], notes: [] }, null, nameOf)).toBe('');
    expect(binCollectionWhen(WED, '2026-10-27')).toBe('Tonight');
    expect(binCollectionWhen(WED, '2026-10-20')).not.toBe('Tonight');
  });

  it('names turns', () => {
    expect(binTurnCaption(null, 'u1', nameOf)).toBeNull();
    expect(binTurnCaption('u1', 'u1', nameOf)).toBe('your turn');
    expect(binTurnCaption('u2', 'u1', nameOf)).toBe("Sam's turn");
  });
});

describe('setup helpers', () => {
  it('picks the next free lid', () => {
    expect(nextFreeBinLid([])).toBe('yellow');
    expect(nextFreeBinLid([{ lid: 'yellow' }, { lid: 'green' }])).toBe('blue');
    expect(nextFreeBinLid(['yellow', 'green', 'blue', 'purple', 'red', 'grey'].map((lid) => ({ lid: lid as BinStream['lid'] })))).toBe('other');
  });

  it('describes a draft change', () => {
    expect(binChangeDraftDetail({ on_date: WED, moved_to: null, note: null })).toBe('none');
    expect(binChangeDraftDetail({ on_date: WED, moved_to: WED, note: 'Extra pickup' })).toBe('extra · Extra pickup');
    expect(binChangeDraftDetail({ on_date: WED, moved_to: '2026-10-29', note: null })).toMatch(/^to /);
  });

  it('says what a read found', () => {
    expect(binReadNote({ changes: [] }, 1)).toBe('Found 1 bin. Check them below, then save.');
    expect(binReadNote({ changes: [{ key: 'a', streamKey: null, on_date: WED, moved_to: null, note: null }] }, 2)).toBe(
      'Found 2 bins and 1 change. Check them below, then save.',
    );
  });
});

describe('createBinsSetupApi', () => {
  it('sends a PDF or a photo to the parser, and says when nothing was found', async () => {
    const post = vi.fn(async () => ({ ok: true as const, data: {} }));
    const api = createBinsSetupApi(post, () => WED);
    const res = await api.readCouncilCalendar({ dataUrl: 'data:x', pdf: true });
    expect(post).toHaveBeenCalledWith('/api/parse-bins', { pdf: 'data:x' });
    expect(res).toEqual({ ok: false, error: 'No bin days found there. Try a clearer photo, or enter them yourself.' });
    await api.readCouncilCalendar({ dataUrl: 'data:y', pdf: false });
    expect(post).toHaveBeenLastCalledWith('/api/parse-bins', { images: ['data:y'] });
  });

  it('passes server errors through', async () => {
    const api = createBinsSetupApi(async () => ({ ok: false, error: 'Nope' }), () => WED);
    expect(await api.readHomeAssistantBins('calendar.bins')).toEqual({ ok: false, error: 'Nope' });
  });

  it('reads Home Assistant collections and calendars', async () => {
    const post = vi.fn(async () => ({
      ok: true as const,
      data: { collections: [], calendars: [{ entityId: 'calendar.bins', name: 'Bins' }] },
    }));
    const api = createBinsSetupApi(post, () => WED);
    const res = await api.readHomeAssistantBins();
    expect(post).toHaveBeenCalledWith('/api/bins/home-assistant', {});
    expect(res.ok && res.calendars).toEqual([{ entityId: 'calendar.bins', name: 'Bins' }]);
    expect(res.ok && res.setup.streams).toEqual([]);
  });
});
