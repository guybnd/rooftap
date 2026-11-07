'use client';

// Documents' slots (.docs/modules.md, section 17). Search: every document,
// fetched once the search opens (the phone hands its synced rows instead).
// Legacy bill files and grocery receipts are searchable only while their
// module is on (module-features.ts).

import { useEffect, useMemo, useState } from 'react';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useModules } from '../../modules-store';
import type { SearchSource } from '../../slots/types';
import { listUnifiedDocuments, type UnifiedDocument } from './documents';

export function documentsSearchHits(documents: readonly UnifiedDocument[]): GlobalHit[] {
  return documents.map((d) => ({
    section: 'documents',
    sectionId: 'documents',
    sectionLabel: 'Documents',
    id: d.key,
    title: d.title ?? d.filename,
    subtitle: d.docType,
    keywords: [d.filename, ...(d.tags ?? [])].filter(Boolean).join(' '),
    href: '/documents',
  }));
}

export const documentsSearchSource: SearchSource = {
  moduleId: 'documents',
  useHits({ groupId, active, supabase, documentStoreRows }) {
    const [documents, setDocuments] = useState<UnifiedDocument[]>([]);
    const [loading, setLoading] = useState(false);
    const { feature } = useModules();
    const costsOn = feature('documents.costs');
    const groceriesOn = feature('documents.groceries');
    const fetchFor = active && supabase ? groupId : undefined;
    // The phone hands a fresh array of the same rows on every render; key the
    // fetch on what the rows are, not the array, or each fetch's own loading
    // flip re-renders, refetches and flickers "Searching" forever.
    const rowsKey = documentStoreRows ? documentStoreRows.map((d) => `${d.id}:${d.updated_at}`).join('|') : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const rows = useMemo(() => documentStoreRows, [rowsKey]);

    useEffect(() => {
      if (!fetchFor || !supabase) return;
      setLoading(true);
      listUnifiedDocuments(supabase, fetchFor, rows, { costs: costsOn, groceries: groceriesOn })
        .then(setDocuments)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [fetchFor, supabase, rows, costsOn, groceriesOn]);

    return useMemo(() => ({ hits: groupId ? documentsSearchHits(documents) : [], loading }), [groupId, documents, loading]);
  },
};
