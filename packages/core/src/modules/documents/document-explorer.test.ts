import { describe, expect, it } from 'vitest';
import {
  documentDetailRows,
  documentExpiryNote,
  documentFolderPath,
  folderAncestorIds,
  folderTreeRows,
  quickUploadFields,
} from './document-explorer';
import type { UnifiedDocument } from './documents';
import type { DocumentFolder } from '../../types';

function folder(id: string, name: string, parent_id: string | null = null): DocumentFolder {
  return {
    id,
    group_id: 'g1',
    name,
    parent_id,
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const TREE: DocumentFolder[] = [
  folder('a', 'House'),
  folder('b', 'Lease', 'a'),
  folder('c', 'Kitchen', 'a'),
  folder('d', 'Appliances', 'c'),
  folder('e', 'Car'),
];

function doc(over: Partial<UnifiedDocument> = {}): UnifiedDocument {
  return {
    key: 'k1',
    storeId: 's1',
    title: 'Dishwasher warranty',
    filename: 'warranty.pdf',
    docType: 'warranty',
    source: 'capture',
    createdAt: new Date().toISOString(),
    storagePath: 'g1/warranty.pdf',
    bucket: 'documents',
    legacy: false,
    groupId: 'g1',
    expiryDate: null,
    tags: [],
    metadata: {},
    uploadedBy: 'u1',
    folderId: null,
    ...over,
  };
}

const isoInDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('folderTreeRows', () => {
  it('lists top-level folders by name when nothing is open', () => {
    expect(folderTreeRows(TREE, [], new Set()).map((r) => r.folder.name)).toEqual(['Car', 'House']);
  });

  it('shows the children of open folders, depth first', () => {
    const rows = folderTreeRows(TREE, [], new Set(['a', 'c']));
    expect(rows.map((r) => [r.folder.name, r.depth])).toEqual([
      ['Car', 0],
      ['House', 0],
      ['Kitchen', 1],
      ['Appliances', 2],
      ['Lease', 1],
    ]);
    expect(rows.find((r) => r.folder.id === 'a')).toMatchObject({ hasChildren: true, expanded: true });
    expect(rows.find((r) => r.folder.id === 'e')).toMatchObject({ hasChildren: false, expanded: false });
  });

  it('counts documents in the whole subtree', () => {
    const rows = folderTreeRows(TREE, [{ folderId: 'd' }, { folderId: 'b' }, { folderId: null }], new Set());
    expect(rows.find((r) => r.folder.id === 'a')?.count).toBe(2);
  });
});

describe('folderAncestorIds', () => {
  it('names the folders above, not the folder itself', () => {
    expect(folderAncestorIds(TREE, 'd')).toEqual(['a', 'c']);
    expect(folderAncestorIds(TREE, 'a')).toEqual([]);
    expect(folderAncestorIds(TREE, null)).toEqual([]);
  });
});

describe('documentFolderPath', () => {
  it('joins the path with slashes', () => {
    expect(documentFolderPath(TREE, 'c')).toBe('House / Kitchen');
    expect(documentFolderPath(TREE, null)).toBe('Not in a folder');
  });
});

describe('documentExpiryNote', () => {
  it('spells out the days and starts with a capital', () => {
    expect(documentExpiryNote(doc({ expiryDate: isoInDays(21) }))).toEqual({ text: 'Expires in 21 days', tone: 'soon' });
  });

  it('is null without an expiry date', () => {
    expect(documentExpiryNote(doc())).toBeNull();
  });

  it('marks an expired file', () => {
    expect(documentExpiryNote(doc({ expiryDate: isoInDays(-3) }))?.tone).toBe('expired');
  });
});

describe('documentDetailRows', () => {
  it('lists type, category fields, folder, who added it and its source', () => {
    const rows = documentDetailRows(doc({ metadata: { manufacturer: 'Bosch' }, folderId: 'c' }), {
      folders: TREE,
      addedBy: 'Ava',
      origin: 'Costs',
    });
    expect(rows[0]).toEqual({ label: 'Type', value: 'Warranty' });
    expect(rows).toContainEqual({ label: 'Folder', value: 'House / Kitchen' });
    expect(rows).toContainEqual({ label: 'Added', value: 'Ava, just now' });
    expect(rows).toContainEqual({ label: 'From', value: 'Costs' });
    expect(rows.some((r) => r.value === 'Bosch')).toBe(true);
  });

  it('leaves out the folder for a legacy file', () => {
    const rows = documentDetailRows(doc({ legacy: true, storeId: null }), { folders: TREE, addedBy: null, origin: null });
    expect(rows.some((r) => r.label === 'Folder')).toBe(false);
  });
});

describe('quickUploadFields', () => {
  it('files an image as a photo and drops the extension', () => {
    expect(quickUploadFields('IMG_2041.jpg', 'image/jpeg')).toEqual({ docType: 'photo', title: 'IMG 2041' });
  });

  it('files anything else as other', () => {
    expect(quickUploadFields('boiler-service.pdf', 'application/pdf')).toEqual({ docType: 'other', title: 'boiler service' });
  });
});
