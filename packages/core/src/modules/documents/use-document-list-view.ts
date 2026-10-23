'use client';

// The Documents list's filter state and everything derived from it, shared by
// apps/web/src/app/documents/page.tsx and apps/mobile's documents screen. The
// caller owns the data (documents, folders) and the open folder, which web
// keeps in the URL and mobile in state; this hook owns the search, filters
// and sort, and returns the folders and sections to draw.

import { useCallback, useMemo, useState } from 'react';
import type { DocType, DocumentFolder } from '../../types';
import { useFuzzySearch } from '../../hooks/use-fuzzy-search';
import { documentExpiryCounts, documentListSections, PRESETS, sameSet, type UnifiedDocument } from './documents';
import { documentsInFolder, foldersInParent } from './document-folders';
import {
  documentsUnderFolder,
  filterDocuments,
  isBrowsingDocuments,
  sortDocuments,
  type DocumentExpiryFilter,
  type DocumentSort,
} from './document-list-view';

export function useDocumentListView<T extends UnifiedDocument>(
  docs: T[],
  folders: DocumentFolder[],
  folderId: string | null
) {
  const [categoryFilters, setCategoryFilters] = useState<Set<DocType>>(new Set());
  const [expiryFilter, setExpiryFilter] = useState<DocumentExpiryFilter>('all');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<DocumentSort>('recent');
  const [search, setSearch] = useState('');
  // The fourteen type chips fold behind "More types" (H: chrome shrinks);
  // they stay open while a type outside the presets is the active filter.
  const [typesExpanded, setTypesExpanded] = useState(false);
  const presetActive = PRESETS.some((p) => sameSet(categoryFilters, p.types));
  const typesOpen = typesExpanded || (categoryFilters.size > 0 && !presetActive);

  const toggleCategory = useCallback(
    (c: DocType) =>
      setCategoryFilters((prev) => {
        const next = new Set(prev);
        if (next.has(c)) next.delete(c); else next.add(c);
        return next;
      }),
    []
  );
  const toggleTagFilter = useCallback(
    (t: string) => setTagFilters((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])),
    []
  );
  const clearAllFilters = useCallback(() => {
    setSearch('');
    setCategoryFilters(new Set());
    setTagFilters([]);
    setExpiryFilter('all');
  }, []);

  const browsing = isBrowsingDocuments(search, { categories: categoryFilters, tags: tagFilters, expiry: expiryFilter });
  const childFolders = useMemo(
    () => (browsing ? foldersInParent(folders, folderId) : []),
    [browsing, folders, folderId]
  );

  // Legacy documents have no folder_id, so they always read as root.
  const filtered = useMemo(
    () =>
      filterDocuments(browsing ? documentsInFolder(docs, folderId) : docs, {
        categories: categoryFilters,
        tags: tagFilters,
        expiry: expiryFilter,
      }),
    [browsing, docs, folderId, categoryFilters, tagFilters, expiryFilter]
  );

  // Fuzzy search narrows the already-filtered set (FLUX-110).
  const searchedDocs = useFuzzySearch(filtered, search, ['filename', 'title']);
  const sortedDocs = useMemo(() => sortDocuments(searchedDocs, sort), [searchedDocs, sort]);

  // Labelled sections under the folders ("Expiring soon", then "Files"). No
  // soon section while the list is already filtered or sorted by expiry,
  // where it would only repeat the list.
  const showSoonGroup = expiryFilter === 'all' && sort !== 'expiry';
  const sections = useMemo(() => documentListSections(sortedDocs, showSoonGroup), [sortedDocs, showSoonGroup]);

  // The Hero lede counts what the surface holds: every document at the top
  // level (and while a search spans the tree), the open folder's whole
  // subtree inside one. Its caption is that set's expiry state.
  const openFolder = browsing && folderId !== null ? (folders.find((f) => f.id === folderId) ?? null) : null;
  const ledeDocs = useMemo(
    () => documentsUnderFolder(docs, folders, openFolder?.id ?? null),
    [docs, folders, openFolder]
  );
  const expiryCounts = useMemo(() => documentExpiryCounts(ledeDocs), [ledeDocs]);

  return {
    categoryFilters,
    setCategoryFilters,
    toggleCategory,
    expiryFilter,
    setExpiryFilter,
    tagFilters,
    setTagFilters,
    toggleTagFilter,
    sort,
    setSort,
    search,
    setSearch,
    typesExpanded,
    setTypesExpanded,
    presetActive,
    typesOpen,
    clearAllFilters,
    browsing,
    childFolders,
    sortedDocs,
    showSoonGroup,
    sections,
    openFolder,
    ledeDocs,
    expiryCounts,
  };
}
