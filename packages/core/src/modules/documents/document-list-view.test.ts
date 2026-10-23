import { describe, expect, it } from 'vitest';
import {
  documentCostIds,
  documentExpiryLabel,
  documentLinksByDoc,
  documentReminderMap,
  documentsUnderFolder,
  filterDocuments,
  groupDocumentsByCost,
  isBrowsingDocuments,
  sortDocuments,
  type DocumentListFilters,
} from './document-list-view';
import type { UnifiedDocument } from './documents';
import type { DocType, DocumentFolder, DocumentLink } from '../../types';

/** An ISO date `days` from now (negative = past). */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000 - 60_000).toISOString();
}

function doc(key: string, over: Partial<UnifiedDocument> = {}): UnifiedDocument {
  return {
    key,
    storeId: key,
    title: null,
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

const none: DocumentListFilters = { categories: new Set(), tags: [], expiry: 'all' };

function link(document_id: string, entity_type: DocumentLink['entity_type'], entity_id: string): DocumentLink {
  return { id: `${document_id}-${entity_id}`, document_id, entity_type, entity_id } as DocumentLink;
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

describe('isBrowsingDocuments', () => {
  it('is true only with no query and no filters', () => {
    expect(isBrowsingDocuments('', none)).toBe(true);
    expect(isBrowsingDocuments('   ', none)).toBe(true);
    expect(isBrowsingDocuments('bill', none)).toBe(false);
    expect(isBrowsingDocuments('', { ...none, categories: new Set<DocType>(['receipt']) })).toBe(false);
    expect(isBrowsingDocuments('', { ...none, tags: ['car'] })).toBe(false);
    expect(isBrowsingDocuments('', { ...none, expiry: 'soon' })).toBe(false);
  });
});

describe('filterDocuments', () => {
  const docs = [
    doc('a', { docType: 'receipt', tags: ['car', '2026'] }),
    doc('b', { docType: 'warranty', tags: ['car'], expiryDate: inDays(10) }),
    doc('c', { docType: 'insurance', expiryDate: inDays(-3) }),
    doc('d', { docType: 'insurance', expiryDate: inDays(90) }),
  ];
  const keys = (f: DocumentListFilters) => filterDocuments(docs, f).map((d) => d.key);

  it('passes everything with no filters', () => {
    expect(keys(none)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps any of the chosen types', () => {
    expect(keys({ ...none, categories: new Set<DocType>(['receipt', 'warranty']) })).toEqual(['a', 'b']);
  });

  it('needs every chosen tag', () => {
    expect(keys({ ...none, tags: ['car'] })).toEqual(['a', 'b']);
    expect(keys({ ...none, tags: ['car', '2026'] })).toEqual(['a']);
  });

  it('splits expiring from expired and drops undated', () => {
    expect(keys({ ...none, expiry: 'soon' })).toEqual(['b']);
    expect(keys({ ...none, expiry: 'expired' })).toEqual(['c']);
  });
});

describe('sortDocuments', () => {
  const docs = [
    doc('a', { title: 'Zebra', expiryDate: null }),
    doc('b', { title: null, filename: 'apple.pdf', expiryDate: inDays(40) }),
    doc('c', { title: 'mango', expiryDate: inDays(-2) }),
  ];

  it("keeps the input order for 'recent' and copies the list", () => {
    const out = sortDocuments(docs, 'recent');
    expect(out.map((d) => d.key)).toEqual(['a', 'b', 'c']);
    expect(out).not.toBe(docs);
  });

  it("sorts by title, or filename when untitled, for 'name'", () => {
    expect(sortDocuments(docs, 'name').map((d) => d.key)).toEqual(['b', 'c', 'a']);
  });

  it("puts the soonest first and undated last for 'expiry'", () => {
    expect(sortDocuments(docs, 'expiry').map((d) => d.key)).toEqual(['c', 'b', 'a']);
  });
});

describe('cost pairing', () => {
  const links = [link('a', 'cost_item', 'cost1'), link('b', 'setup_item', 's1'), link('c', 'cost_item', 'cost1'), link('d', 'cost_item', 'cost2')];
  const docs = [doc('a'), doc('b'), doc('c'), doc('d'), doc('legacy', { storeId: null })];

  it('groups links by document', () => {
    const m = documentLinksByDoc(links);
    expect(m.get('a')?.map((l) => l.entity_id)).toEqual(['cost1']);
    expect(m.get('x')).toBeUndefined();
  });

  it('maps each document to its first cost', () => {
    expect(documentCostIds(docs, documentLinksByDoc(links))).toEqual({ a: 'cost1', c: 'cost1', d: 'cost2' });
  });

  it('pulls documents sharing a cost together, keeping the first in place', () => {
    const ids = documentCostIds(docs, documentLinksByDoc(links));
    expect(groupDocumentsByCost(docs, ids).map((d) => d.key)).toEqual(['a', 'c', 'b', 'd', 'legacy']);
  });

  it('leaves a list with no shared cost as it was', () => {
    expect(groupDocumentsByCost(docs, {}).map((d) => d.key)).toEqual(['a', 'b', 'c', 'd', 'legacy']);
  });
});

describe('documentReminderMap', () => {
  it('maps document reminders and skips other keys', () => {
    expect(
      documentReminderMap([
        { id: 't1', template_key: 'doc-reminder:doc1:expiry' },
        { id: 't2', template_key: null },
        { id: 't3', template_key: 'something-else' },
      ])
    ).toEqual({ doc1: 't1' });
  });
});

describe('documentsUnderFolder', () => {
  const folders = [folder('f1'), folder('f2', 'f1'), folder('f3')];
  const docs = [doc('root'), doc('in1', { folderId: 'f1' }), doc('in2', { folderId: 'f2' }), doc('in3', { folderId: 'f3' })];

  it('is every document at the top level', () => {
    expect(documentsUnderFolder(docs, folders, null)).toBe(docs);
  });

  it("is the folder's whole subtree inside one", () => {
    expect(documentsUnderFolder(docs, folders, 'f1').map((d) => d.key)).toEqual(['in1', 'in2']);
  });
});

describe('documentExpiryLabel', () => {
  it('names expired, soon and far expiries with their tone', () => {
    expect(documentExpiryLabel(-3, '2026-01-01')).toEqual({ text: 'expired 3d ago', tone: 'expired' });
    expect(documentExpiryLabel(0, '2026-01-01')).toEqual({ text: 'expires today', tone: 'soon' });
    expect(documentExpiryLabel(1, '2026-01-01')).toEqual({ text: 'expires tomorrow', tone: 'soon' });
    expect(documentExpiryLabel(12, '2026-01-01')).toEqual({ text: 'expires in 12d', tone: 'soon' });
    expect(documentExpiryLabel(400, '2031-03-04').tone).toBe('later');
    expect(documentExpiryLabel(400, '2031-03-04').text).toBe('expires Mar 2031');
    expect(documentExpiryLabel(-400, '2020-03-04').text).toBe('expired Mar 2020');
  });
});
