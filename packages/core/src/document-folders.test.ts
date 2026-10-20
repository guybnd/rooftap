import { describe, expect, it } from 'vitest';
import {
  listDocumentFolders,
  foldersInParent,
  folderBreadcrumb,
  folderDescendantIds,
  canMoveFolder,
  moveTargetsFor,
  folderMoveOptions,
  draftDocumentFolder,
  documentsInFolder,
  folderDocumentCount,
  folderContentsLabel,
  isFilable,
} from './document-folders';
import type { DocumentFolder } from './types';

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

//  root
//   ├── house        (a)
//   │    ├── lease   (b)
//   │    └── utils   (c)
//   │         └── gas (d)
//   └── admin        (e)
const TREE: DocumentFolder[] = [
  folder('a', 'House'),
  folder('b', 'Lease', 'a'),
  folder('c', 'Utilities', 'a'),
  folder('d', 'Gas', 'c'),
  folder('e', 'Admin'),
];

describe('foldersInParent', () => {
  it('returns direct children only, name-sorted', () => {
    expect(foldersInParent(TREE, null).map((f) => f.name)).toEqual(['Admin', 'House']);
    expect(foldersInParent(TREE, 'a').map((f) => f.name)).toEqual(['Lease', 'Utilities']);
    expect(foldersInParent(TREE, 'd')).toEqual([]);
  });
});

describe('folderBreadcrumb', () => {
  it('is empty at the root', () => {
    expect(folderBreadcrumb(TREE, null)).toEqual([]);
  });

  it('walks root-first to the folder', () => {
    expect(folderBreadcrumb(TREE, 'd').map((f) => f.name)).toEqual(['House', 'Utilities', 'Gas']);
  });

  it('terminates on a cycle instead of hanging the render', () => {
    // The DB trigger refuses these, but a row written before it existed must
    // not spin forever.
    const cyclic = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')];
    const crumb = folderBreadcrumb(cyclic, 'x');
    expect(crumb.length).toBeLessThanOrEqual(2);
  });

  it('stops cleanly when a parent is missing', () => {
    expect(folderBreadcrumb([folder('z', 'Z', 'gone')], 'z').map((f) => f.name)).toEqual(['Z']);
  });
});

describe('folderDescendantIds', () => {
  it('collects the whole subtree, excluding the folder itself', () => {
    expect(folderDescendantIds(TREE, 'a')).toEqual(new Set(['b', 'c', 'd']));
    expect(folderDescendantIds(TREE, 'c')).toEqual(new Set(['d']));
    expect(folderDescendantIds(TREE, 'e')).toEqual(new Set());
  });
});

describe('canMoveFolder', () => {
  it('allows a move to the root or to an unrelated folder', () => {
    expect(canMoveFolder(TREE, 'c', null)).toBe(true);
    expect(canMoveFolder(TREE, 'c', 'e')).toBe(true);
  });

  it('refuses a folder becoming its own parent', () => {
    expect(canMoveFolder(TREE, 'a', 'a')).toBe(false);
  });

  it('refuses descending into its own subtree, which would orphan it', () => {
    expect(canMoveFolder(TREE, 'a', 'd')).toBe(false);
    expect(canMoveFolder(TREE, 'c', 'd')).toBe(false);
  });

  it('offers only non-cycling destinations', () => {
    expect(moveTargetsFor(TREE, 'a').map((f) => f.id)).toEqual(['e']);
    // Nothing being moved: every folder is a valid destination.
    expect(moveTargetsFor(TREE, null)).toHaveLength(TREE.length);
  });
});

describe('document placement', () => {
  const docs = [
    { key: '1', folderId: null },
    { key: '2', folderId: 'a' },
    { key: '3', folderId: 'd' },
    { key: '4', folderId: 'd' },
    { key: '5', folderId: 'e' },
  ];

  it('lists only documents filed directly in a folder', () => {
    expect(documentsInFolder(docs, null).map((d) => d.key)).toEqual(['1']);
    expect(documentsInFolder(docs, 'd').map((d) => d.key)).toEqual(['3', '4']);
  });

  it('counts the whole subtree, so a folder of sub-folders never reads as empty', () => {
    // House holds one directly, plus two down in Utilities/Gas.
    expect(folderDocumentCount(TREE, docs, 'a')).toBe(3);
    expect(folderDocumentCount(TREE, docs, 'c')).toBe(2);
    expect(folderDocumentCount(TREE, docs, 'd')).toBe(2);
    expect(folderDocumentCount(TREE, docs, 'e')).toBe(1);
  });

  it('treats a document with no folder as root, never inside a folder', () => {
    expect(folderDocumentCount(TREE, [{ key: '1', folderId: null }], 'a')).toBe(0);
  });
});

describe('folderContentsLabel', () => {
  it('leads with the subtree document count, then the direct sub-folders', () => {
    const docs = [
      { key: '1', folderId: 'b' },
      { key: '2', folderId: 'd' },
      { key: '3', folderId: 'd' },
    ];
    // House holds Lease and Utilities directly; Gas is a grandchild.
    expect(folderContentsLabel(TREE, docs, 'a')).toBe('3 documents · 2 folders');
    expect(folderContentsLabel(TREE, docs, 'c')).toBe('2 documents · 1 folder');
    expect(folderContentsLabel(TREE, docs, 'b')).toBe('1 document');
  });

  it('names a folder holding only sub-folders, and an empty one', () => {
    expect(folderContentsLabel(TREE, [], 'c')).toBe('1 folder');
    expect(folderContentsLabel(TREE, [], 'e')).toBe('Empty');
  });
});

describe('isFilable', () => {
  it('accepts store-backed documents and refuses legacy ones', () => {
    expect(isFilable({ legacy: false, storeId: 'doc-1' })).toBe(true);
    // Legacy documents have no row in `documents`, so nowhere to record a folder.
    expect(isFilable({ legacy: true, storeId: null })).toBe(false);
    expect(isFilable({ legacy: false, storeId: null })).toBe(false);
  });
});

describe('listDocumentFolders', () => {
  // Minimal stand-in for the query chain listDocumentFolders builds.
  function stub(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: async () => ({ data: result.data ?? null, error: result.error ?? null }),
    };
    return { from: () => chain } as never;
  }

  it('returns the rows on success', async () => {
    const rows = [folder('a', 'House')];
    await expect(listDocumentFolders(stub({ data: rows }), 'g1')).resolves.toEqual(rows);
  });

  it('degrades to no folders when the table does not exist yet', async () => {
    // The app and the database deploy off the same push in no guaranteed
    // order, and mobile gets JS over the air with no store release at all, so
    // a client can genuinely run ahead of its database. Both Documents
    // screens fetch this inside the same Promise.all as the documents, so
    // throwing here would take the whole screen down instead of the folders.
    for (const code of ['42P01', 'PGRST205', 'PGRST106']) {
      await expect(
        listDocumentFolders(stub({ error: { code, message: 'no such table' } }), 'g1')
      ).resolves.toEqual([]);
    }
  });

  it('still throws on a real failure, so permission bugs stay visible', async () => {
    await expect(
      listDocumentFolders(stub({ error: { code: '42501', message: 'permission denied' } }), 'g1')
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('folderMoveOptions', () => {
  it('lists the tree depth-first with siblings name-sorted', () => {
    expect(folderMoveOptions(TREE, null).map((o) => [o.folder.id, o.depth])).toEqual([
      ['e', 0],
      ['a', 0],
      ['b', 1],
      ['c', 1],
      ['d', 2],
    ]);
  });

  it('carries the ancestor path for each row', () => {
    const gas = folderMoveOptions(TREE, null).find((o) => o.folder.id === 'd');
    expect(gas?.path).toEqual(['House', 'Utilities']);
  });

  it('leaves out the moving folder and its whole subtree', () => {
    expect(folderMoveOptions(TREE, 'c').map((o) => o.folder.id)).toEqual(['e', 'a', 'b']);
  });

  it('survives a cycle that predates the database trigger', () => {
    const cyclic = [folder('x', 'X', 'y'), folder('y', 'Y', 'x'), folder('z', 'Z')];
    expect(folderMoveOptions(cyclic, null).map((o) => o.folder.id)).toEqual(['z']);
  });
});

describe('draftDocumentFolder', () => {
  it('builds a full row with a fresh id and a trimmed name', () => {
    const a = draftDocumentFolder({ groupId: 'g1', name: '  Bills ', parentId: 'a', createdBy: 'u1' });
    const b = draftDocumentFolder({ groupId: 'g1', name: 'Bills', parentId: null, createdBy: 'u1' });
    expect(a).toMatchObject({ group_id: 'g1', name: 'Bills', parent_id: 'a', created_by: 'u1' });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
  });
});
