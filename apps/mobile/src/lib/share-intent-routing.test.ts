import { describe, expect, it } from 'vitest';
import { ALL_MODULE_IDS, isFeatureEnabled, type ModuleFeatureId, type ModuleId } from '@homeup/core';
import {
  availableShareCategories,
  resolveShareRoute as resolveWith,
  type MinimalShareIntent,
} from './share-intent-routing';

function intent(overrides: Partial<MinimalShareIntent>): MinimalShareIntent {
  return { type: null, webUrl: null, files: null, ...overrides };
}

function featuresFor(enabled: ReadonlySet<string>) {
  return (id: ModuleFeatureId) => isFeatureEnabled(id, enabled);
}

const allOn = new Set<string>(ALL_MODULE_IDS);
const resolveShareRoute = (i: MinimalShareIntent) => resolveWith(i, featuresFor(allOn));

describe('resolveShareRoute', () => {
  it('routes a shared listing URL to /apartment/new with an encoded listing_url param', () => {
    const decision = resolveShareRoute(
      intent({ type: 'weburl', webUrl: 'https://www.realestate.com.au/property-123' })
    );
    expect(decision).toEqual({
      kind: 'weburl',
      href: '/apartment/new?listing_url=https%3A%2F%2Fwww.realestate.com.au%2Fproperty-123',
    });
  });

  it('routes one or more shared images to the media path with their full file info (HOUP-265: the share action picker needs mimeType/fileName, not just uris)', () => {
    const files = [
      { path: 'file:///cache/a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg' },
      { path: 'file:///cache/b.png', mimeType: 'image/png', fileName: 'b.png' },
    ];
    const decision = resolveShareRoute(intent({ type: 'media', files }));
    expect(decision).toEqual({ kind: 'media', files });
  });

  it('routes a single shared image to the media path the same way (HOUP-265: single vs multi is decided by the picker, not resolveShareRoute)', () => {
    const files = [{ path: 'file:///cache/a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg' }];
    const decision = resolveShareRoute(intent({ type: 'media', files }));
    expect(decision).toEqual({ kind: 'media', files });
  });

  it('routes a shared .ics file (by mimeType) to the ics path', () => {
    const icsFile = { path: 'file:///cache/invite.ics', mimeType: 'text/calendar', fileName: 'invite.ics' };
    const decision = resolveShareRoute(intent({ type: 'file', files: [icsFile] }));
    expect(decision).toEqual({ kind: 'ics', file: icsFile });
  });

  it('routes a shared .ics file by extension when the mimeType is generic', () => {
    const icsFile = { path: 'file:///cache/invite.ics', mimeType: 'application/octet-stream', fileName: 'invite.ics' };
    const decision = resolveShareRoute(intent({ type: 'file', files: [icsFile] }));
    expect(decision).toEqual({ kind: 'ics', file: icsFile });
  });

  it('ignores a shared file that is not an .ics (no PDF intent filter is declared, but guard anyway)', () => {
    const decision = resolveShareRoute(
      intent({ type: 'file', files: [{ path: 'file:///cache/doc.pdf', mimeType: 'application/pdf', fileName: 'doc.pdf' }] })
    );
    expect(decision).toEqual({ kind: 'none' });
  });

  it('ignores plain text with no detected URL', () => {
    const decision = resolveShareRoute(intent({ type: 'text', webUrl: null }));
    expect(decision).toEqual({ kind: 'none' });
  });

  it('ignores an empty/null intent', () => {
    expect(resolveShareRoute(intent({}))).toEqual({ kind: 'none' });
  });
});

// Modules (module-features.ts): switch each module off in turn; only the
// destinations that write into it go, and a share with nowhere left to go
// resolves to `unavailable` instead of routing into a switched-off module.
describe('resolveShareRoute with modules switched off', () => {
  const url = intent({ type: 'weburl', webUrl: 'https://example.com/listing' });
  const photo = { path: 'file:///cache/a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg' };
  const onePhoto = intent({ type: 'media', files: [photo] });
  const twoPhotos = intent({ type: 'media', files: [photo, { ...photo, path: 'file:///cache/b.jpg', fileName: 'b.jpg' }] });
  const ics = intent({ type: 'file', files: [{ path: 'file:///cache/invite.ics', mimeType: 'text/calendar', fileName: 'invite.ics' }] });

  // Which modules each share category writes into.
  const CATEGORY_NEEDS: Record<string, ModuleId[]> = {
    document: ['documents'],
    invoice: ['costs', 'documents'],
    grocery: ['groceries'],
    apartment: ['search'],
  };

  it.each(ALL_MODULE_IDS)('with %s off', (off) => {
    const enabled = new Set<string>(ALL_MODULE_IDS.filter((m) => m !== off));
    const feature = featuresFor(enabled);

    expect(resolveWith(url, feature).kind).toBe(off === 'search' ? 'unavailable' : 'weburl');
    expect(resolveWith(ics, feature).kind).toBe(off === 'search' ? 'unavailable' : 'ics');
    // Several files are saved as documents.
    expect(resolveWith(twoPhotos, feature).kind).toBe(off === 'documents' ? 'unavailable' : 'media');
    // One file opens the picker, which still has other categories to offer.
    expect(resolveWith(onePhoto, feature).kind).toBe('media');

    expect(availableShareCategories(feature)).toEqual(
      ['document', 'invoice', 'grocery', 'apartment'].filter((c) => !CATEGORY_NEEDS[c].includes(off))
    );
  });

  it('offers every share category when every module is on', () => {
    expect(availableShareCategories(featuresFor(allOn))).toEqual(['document', 'invoice', 'grocery', 'apartment']);
  });

  it('resolves a single file to unavailable when no share category is left', () => {
    const feature = featuresFor(new Set(['household', 'calendar', 'checklists', 'recipes', 'setup']));
    expect(availableShareCategories(feature)).toEqual([]);
    expect(resolveWith(onePhoto, feature)).toEqual({ kind: 'unavailable' });
    expect(resolveWith(url, feature)).toEqual({ kind: 'unavailable' });
    expect(resolveWith(ics, feature)).toEqual({ kind: 'unavailable' });
  });

  it('keeps a single file when only one share category is left', () => {
    const feature = featuresFor(new Set(['groceries']));
    expect(availableShareCategories(feature)).toEqual(['grocery']);
    expect(resolveWith(onePhoto, feature).kind).toBe('media');
    expect(resolveWith(twoPhotos, feature).kind).toBe('unavailable');
  });

  it('still ignores an unsupported share as none, whatever is switched off', () => {
    expect(resolveWith(intent({ type: 'text', webUrl: null }), featuresFor(new Set()))).toEqual({ kind: 'none' });
  });
});
