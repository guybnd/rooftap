import { describe, expect, it } from 'vitest';
import {
  WHATS_NEW_MAX_ROWS,
  buildWhatsNewView,
  fixesLabel,
  isEntryVisible,
  resolveSeen,
  serializeSeen,
  unseenEntries,
  whatsNewDayLabel,
  whatsNewHeadline,
  type WhatsNewContext,
  type WhatsNewEntry,
} from './whats-new';

function entry(id: string, over: Partial<WhatsNewEntry> = {}): WhatsNewEntry {
  return { id, date: '2026-10-21', title: id, body: 'Body.', module: 'app', kind: 'improvement', version: null, ...over };
}

const ctx: WhatsNewContext = { platform: 'mobile', enabled: new Set(['groceries', 'household']) };

describe('isEntryVisible', () => {
  it('shows app-wide entries and entries for modules that are on', () => {
    expect(isEntryVisible(entry('a'), ctx)).toBe(true);
    expect(isEntryVisible(entry('g', { module: 'groceries' }), ctx)).toBe(true);
  });

  it('leaves no trace of a module that is off', () => {
    expect(isEntryVisible(entry('s', { module: 'shopper' }), ctx)).toBe(false);
  });

  it('skips a section this person hid', () => {
    expect(isEntryVisible(entry('g', { module: 'groceries' }), { ...ctx, hidden: ['groceries'] })).toBe(false);
  });

  it('treats non-module sections as always on', () => {
    expect(isEntryVisible(entry('h', { module: 'home' }), ctx)).toBe(true);
  });

  it('filters by platform and server', () => {
    expect(isEntryVisible(entry('w', { platforms: ['web'] }), ctx)).toBe(false);
    expect(isEntryVisible(entry('m', { platforms: ['mobile'] }), ctx)).toBe(true);
    expect(isEntryVisible(entry('x', { server: 'shopper.scout' }), { ...ctx, serverSupports: () => false })).toBe(false);
    expect(isEntryVisible(entry('x', { server: 'shopper.scout' }), { ...ctx, serverSupports: () => true })).toBe(true);
  });
});

describe('seen state', () => {
  const entries = [entry('new', { date: '2026-10-20' }), entry('old', { date: '2026-09-01' })];

  it('seeds a first launch with everything older than a week', () => {
    const { seen, seeded } = resolveSeen(null, entries, '2026-10-21');
    expect(seeded).toBe(true);
    expect([...seen]).toEqual(['old']);
  });

  it('reads stored ids', () => {
    expect(resolveSeen('["new"]', entries, '2026-10-21')).toEqual({ seen: new Set(['new']), seeded: false });
  });

  it('seeds again when storage is unreadable', () => {
    expect(resolveSeen('{oops', entries, '2026-10-21').seeded).toBe(true);
  });

  it('keeps only ids still bundled', () => {
    expect(JSON.parse(serializeSeen(new Set(['gone', 'old']), ['new'], entries))).toEqual(['new', 'old']);
  });
});

describe('unseenEntries', () => {
  it('drops seen, hidden and stale entries', () => {
    const list = [
      entry('fresh'),
      entry('seen'),
      entry('off', { module: 'shopper' }),
      entry('stale', { date: '2026-07-01' }),
    ];
    expect(unseenEntries(list, new Set(['seen']), ctx, '2026-10-21').map((e) => e.id)).toEqual(['fresh']);
  });
});

describe('buildWhatsNewView', () => {
  it('puts spotlights on their own, features first, and folds fixes', () => {
    const view = buildWhatsNewView(
      [
        entry('imp'),
        entry('big', { kind: 'feature', spotlight: true }),
        entry('feat', { kind: 'feature' }),
        entry('fix1', { kind: 'fix' }),
        entry('fix2', { kind: 'fix' }),
      ],
      []
    );
    expect(view.spotlights.map((e) => e.id)).toEqual(['big']);
    expect(view.groups.map((g) => g.entries.map((e) => e.id))).toEqual([['feat', 'imp']]);
    expect(view.fixes).toHaveLength(2);
    expect(view.showVersions).toBe(false);
    expect(view.total).toBe(5);
  });

  it('groups by release when the entries span several, newest first, and caps the rows', () => {
    const releases = [
      { version: '1.3.0', date: '2026-10-14' },
      { version: '1.2.0', date: '2026-10-01' },
    ];
    const list = [
      ...Array.from({ length: 4 }, (_, i) => entry(`u${i}`, { date: '2026-10-20' })),
      ...Array.from({ length: 3 }, (_, i) => entry(`a${i}`, { date: '2026-10-10', version: '1.3.0' })),
      entry('b0', { date: '2026-09-25', version: '1.2.0', kind: 'feature' }),
    ];
    const view = buildWhatsNewView(list, releases);
    expect(view.showVersions).toBe(true);
    expect(view.groups.map((g) => g.version)).toEqual([null, '1.3.0']);
    expect(view.groups.reduce((n, g) => n + g.entries.length, 0)).toBe(WHATS_NEW_MAX_ROWS);
    expect(view.moreCount).toBe(2);
    expect(view.groups[1].date).toBe('2026-10-14');
  });

  it('lists everything, fixes included, for the history', () => {
    const view = buildWhatsNewView(
      [entry('f', { kind: 'fix' }), entry('s', { kind: 'feature', spotlight: true })],
      [],
      { maxRows: Infinity, spotlights: false, foldFixes: false }
    );
    expect(view.spotlights).toEqual([]);
    expect(view.fixes).toEqual([]);
    expect(view.groups[0].entries.map((e) => e.id)).toEqual(['s', 'f']);
  });
});

describe('copy helpers', () => {
  it('labels days relative to today', () => {
    expect(whatsNewDayLabel('2026-10-21', '2026-10-21')).toBe('Today');
    expect(whatsNewDayLabel('2026-10-20', '2026-10-21')).toBe('Yesterday');
    expect(whatsNewDayLabel('2026-10-18', '2026-10-21')).toBe('3 days ago');
    expect(whatsNewDayLabel('2026-10-10', '2026-10-21')).toBe('Last week');
    expect(whatsNewDayLabel('2026-09-21', '2026-10-21')).toBe('4 weeks ago');
  });

  it('heads the sheet with the count, or the releases skipped', () => {
    expect(whatsNewHeadline(buildWhatsNewView([entry('a')], []))).toBe('One new thing since you last looked');
    expect(whatsNewHeadline(buildWhatsNewView([entry('a'), entry('b')], []))).toBe('2 new things since you last looked');
    const multi = buildWhatsNewView(
      [entry('a', { version: '1.3.0' }), entry('b', { version: '1.2.0' })],
      [
        { version: '1.3.0', date: '2026-10-14' },
        { version: '1.2.0', date: '2026-10-01' },
      ]
    );
    expect(whatsNewHeadline(multi)).toBe('2 releases since you last looked');
    expect(fixesLabel(1)).toBe('And 1 smaller fix');
    expect(fixesLabel(4)).toBe('And 4 smaller fixes');
  });
});
