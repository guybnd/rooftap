// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentListView } from './use-document-list-view';
import type { UnifiedDocument } from './documents';
import type { DocumentFolder } from '../../types';

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000 - 60_000).toISOString();
}

function doc(key: string, over: Partial<UnifiedDocument> = {}): UnifiedDocument {
  return {
    key,
    storeId: key,
    title: key,
    filename: `${key}.pdf`,
    docType: 'other',
    source: 'capture',
    createdAt: '2026-01-01T00:00:00.000Z',
    storagePath: `g1/${key}.pdf`,
    bucket: 'documents',
    legacy: false,
    groupId: 'g1',
    expiryDate: null,
    tags: [],
    metadata: {},
    uploadedBy: null,
    folderId: null,
    ...over,
  };
}

function folder(id: string, parent_id: string | null = null): DocumentFolder {
  return {
    id,
    group_id: 'g1',
    name: id,
    parent_id,
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const folders = [folder('f1'), folder('f2', 'f1')];
const docs = [
  doc('lease', { docType: 'lease_contract', expiryDate: inDays(5) }),
  doc('receipt', { docType: 'receipt', tags: ['car'] }),
  doc('manual', { docType: 'manual', folderId: 'f1' }),
  doc('deep', { docType: 'warranty', folderId: 'f2', expiryDate: inDays(-1) }),
];

const keysOf = (sections: { key: string; docs: UnifiedDocument[] }[]) =>
  sections.map((s) => [s.key, s.docs.map((d) => d.key)]);

afterEach(() => {
  vi.useRealTimers();
});

describe('useDocumentListView', () => {
  it('browses the open folder: its child folders and its own files, soon first', () => {
    const { result, rerender } = renderHook(({ folderId }) => useDocumentListView(docs, folders, folderId), {
      initialProps: { folderId: null as string | null },
    });
    expect(result.current.browsing).toBe(true);
    expect(result.current.childFolders.map((f) => f.id)).toEqual(['f1']);
    expect(keysOf(result.current.sections)).toEqual([
      ['soon', ['lease']],
      ['files', ['receipt']],
    ]);
    expect(result.current.openFolder).toBeNull();
    expect(result.current.ledeDocs).toHaveLength(4);
    expect(result.current.expiryCounts).toEqual({ soon: 1, expired: 1 });

    rerender({ folderId: 'f1' });
    expect(result.current.childFolders.map((f) => f.id)).toEqual(['f2']);
    expect(keysOf(result.current.sections)).toEqual([['files', ['manual']]]);
    expect(result.current.openFolder?.id).toBe('f1');
    expect(result.current.ledeDocs.map((d) => d.key)).toEqual(['manual', 'deep']);
  });

  it('looks across every folder once a filter is on, and clears back', () => {
    const { result } = renderHook(() => useDocumentListView(docs, folders, 'f1'));
    act(() => result.current.setExpiryFilter('expired'));
    expect(result.current.browsing).toBe(false);
    expect(result.current.childFolders).toEqual([]);
    expect(result.current.openFolder).toBeNull();
    // No soon section while the list is filtered by expiry.
    expect(keysOf(result.current.sections)).toEqual([['files', ['deep']]]);

    act(() => result.current.clearAllFilters());
    expect(result.current.browsing).toBe(true);
    expect(result.current.expiryFilter).toBe('all');
  });

  it('toggles types and tags, and opens the type chips for a type outside the presets', () => {
    const { result } = renderHook(() => useDocumentListView(docs, folders, null));
    act(() => result.current.toggleCategory('manual'));
    expect(result.current.typesOpen).toBe(true);
    expect(result.current.sortedDocs.map((d) => d.key)).toEqual(['manual']);
    act(() => result.current.toggleCategory('manual'));
    expect(result.current.categoryFilters.size).toBe(0);

    act(() => result.current.setCategoryFilters(new Set(['receipt', 'invoice'])));
    expect(result.current.presetActive).toBe(true);
    expect(result.current.typesOpen).toBe(false);

    act(() => result.current.setCategoryFilters(new Set()));
    act(() => result.current.toggleTagFilter('car'));
    expect(result.current.sortedDocs.map((d) => d.key)).toEqual(['receipt']);
    act(() => result.current.toggleTagFilter('car'));
    expect(result.current.tagFilters).toEqual([]);
  });

  it('sorts by expiry without a soon section', () => {
    const { result } = renderHook(() => useDocumentListView(docs, folders, null));
    act(() => result.current.setCategoryFilters(new Set(['lease_contract', 'warranty', 'receipt'])));
    act(() => result.current.setSort('expiry'));
    expect(result.current.showSoonGroup).toBe(false);
    expect(keysOf(result.current.sections)).toEqual([['files', ['deep', 'lease', 'receipt']]]);
  });

  it('narrows by fuzzy search after the debounce', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDocumentListView(docs, folders, null));
    act(() => result.current.setSearch('manual'));
    expect(result.current.browsing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.sortedDocs.map((d) => d.key)).toEqual(['manual']);
  });
});
