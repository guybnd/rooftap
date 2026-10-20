import { afterEach, describe, expect, it, vi } from 'vitest';

// HOUP-83: uploadDocument/registerDocument pull the new row into the local
// store via `syncState(documents$(groupId)).sync()` — stub both so the test
// doesn't need a configured StoreEnvironment (documents$ throws without one).
vi.mock('./data/stores', () => ({
  documents$: vi.fn(() => ({})),
}));
vi.mock('@legendapp/state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@legendapp/state')>();
  return { ...actual, syncState: vi.fn(() => ({ sync: vi.fn(() => Promise.resolve()) })) };
});

import {
  validateDocumentMeta,
  uploadDocument,
  registerDocument,
  listUnifiedDocuments,
  visibleDocumentLinks,
  documentLinkHref,
  isCaptureCategoryEnabled,
  documentExpiryCounts,
  documentListSections,
  CAPTURE_CATEGORY_FEATURES,
  DOCUMENT_MAX_BYTES,
  type CaptureCategoryId,
  type DocumentUploadInput,
} from './documents';
import { ALL_MODULE_IDS } from './modules';
import { configureDocumentStorage, type DocumentStorageEnvironment } from './document-storage';
import { signedDocumentUrl, SUPABASE_DOCUMENT_MAX_BYTES } from './documents';
import { getModuleIdForPath } from './sections';
import { isFeatureEnabled } from './module-features';

describe('validateDocumentMeta', () => {
  it('accepts every whitelisted MIME type under the size cap', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(validateDocumentMeta({ mimeType, sizeBytes: 1024 })).toBeNull();
    }
  });

  it('rejects a null or unsupported MIME type', () => {
    expect(validateDocumentMeta({ mimeType: null, sizeBytes: 1024 })).toMatch(/images.*or PDF/i);
    expect(validateDocumentMeta({ mimeType: 'text/plain', sizeBytes: 1024 })).toMatch(/images.*or PDF/i);
  });

  it('rejects a file over the 50 MB cap, accepts right at the boundary', () => {
    expect(validateDocumentMeta({ mimeType: 'image/png', sizeBytes: DOCUMENT_MAX_BYTES })).toBeNull();
    expect(validateDocumentMeta({ mimeType: 'image/png', sizeBytes: DOCUMENT_MAX_BYTES + 1 })).toMatch(/too large/i);
  });
});

type QueryResult = { data: unknown; error: unknown };

function makeQueryBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function makeFakeSupabase(opts: {
  insertResult: QueryResult;
  uploadError?: { message: string } | null;
}) {
  const storageUpload = vi.fn(() => Promise.resolve({ data: { path: 'x' }, error: opts.uploadError ?? null }));
  const storageRemove = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })) },
    storage: { from: vi.fn(() => ({ upload: storageUpload, remove: storageRemove })) },
    from: vi.fn(() => makeQueryBuilder(opts.insertResult)),
    __storageUpload: storageUpload,
    __storageRemove: storageRemove,
  };
}

const fakeInput: DocumentUploadInput = {
  body: new Blob(['hello'], { type: 'image/png' }),
  filename: 'warranty.png',
  mimeType: 'image/png',
  sizeBytes: 5,
};

describe('uploadDocument', () => {
  it('throws before touching storage/network when validation fails', async () => {
    const supabase = makeFakeSupabase({ insertResult: { data: null, error: null } });
    await expect(
      uploadDocument({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
        groupId: 'group-1',
        input: { ...fakeInput, mimeType: 'text/plain' },
        docType: 'other',
        source: 'capture',
      })
    ).rejects.toThrow(/images.*or PDF/i);
    expect(supabase.__storageUpload).not.toHaveBeenCalled();
  });

  it('uploads the body with contentType and inserts a row on success', async () => {
    const row = { id: 'doc-1', group_id: 'group-1', filename: 'warranty.png' };
    const supabase = makeFakeSupabase({ insertResult: { data: row, error: null } });
    const result = await uploadDocument({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      groupId: 'group-1',
      input: fakeInput,
      docType: 'warranty',
      source: 'capture',
    });
    expect(result).toEqual(row);
    expect(supabase.__storageUpload).toHaveBeenCalledWith(
      expect.stringContaining('group-1/'),
      fakeInput.body,
      { contentType: 'image/png' }
    );
    expect(supabase.__storageRemove).not.toHaveBeenCalled();
  });

  it('rolls back the uploaded storage object when the row insert fails', async () => {
    const supabase = makeFakeSupabase({ insertResult: { data: null, error: { message: 'db down' } } });
    await expect(
      uploadDocument({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
        groupId: 'group-1',
        input: fakeInput,
        docType: 'other',
        source: 'capture',
      })
    ).rejects.toThrow(/could not save/i);
    expect(supabase.__storageRemove).toHaveBeenCalled();
  });

  it('surfaces an upload failure without inserting a row', async () => {
    const supabase = makeFakeSupabase({
      insertResult: { data: null, error: null },
      uploadError: { message: 'network blip' },
    });
    await expect(
      uploadDocument({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
        groupId: 'group-1',
        input: fakeInput,
        docType: 'other',
        source: 'capture',
      })
    ).rejects.toThrow(/upload failed/i);
  });
});

describe('uploadDocument with R2 (document-storage seam)', () => {
  const row = { id: 'doc-1', group_id: 'group-1', filename: 'warranty.png' };

  function storageEnv(reply: unknown, putStatus = 200) {
    const env = {
      postJson: vi.fn(async () => reply),
      putFile: vi.fn(async () => putStatus),
    } satisfies DocumentStorageEnvironment;
    configureDocumentStorage(env);
    return env;
  }

  afterEach(() => configureDocumentStorage(null));

  it('puts the file in R2 and skips Supabase Storage when the server offers R2', async () => {
    const env = storageEnv({ provider: 'r2', url: 'https://r2/put', headers: { 'Content-Type': 'image/png' } });
    const supabase = makeFakeSupabase({ insertResult: { data: row, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await uploadDocument({ supabase: supabase as any, groupId: 'group-1', input: fakeInput, docType: 'warranty', source: 'capture' });
    expect(env.postJson).toHaveBeenCalledWith('/api/storage', expect.objectContaining({ op: 'upload', bucket: 'documents', sizeBytes: fakeInput.sizeBytes }));
    expect(env.putFile).toHaveBeenCalledWith('https://r2/put', { 'Content-Type': 'image/png' }, { body: fakeInput.body, uri: undefined });
    expect(supabase.__storageUpload).not.toHaveBeenCalled();
  });

  it('falls back to Supabase Storage when the R2 upload fails', async () => {
    storageEnv({ provider: 'r2', url: 'https://r2/put' }, 403);
    const supabase = makeFakeSupabase({ insertResult: { data: row, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await uploadDocument({ supabase: supabase as any, groupId: 'group-1', input: fakeInput, docType: 'warranty', source: 'capture' });
    expect(supabase.__storageUpload).toHaveBeenCalled();
  });

  it('falls back to Supabase Storage when the server says so', async () => {
    const env = storageEnv({ provider: 'supabase', r2: false });
    const supabase = makeFakeSupabase({ insertResult: { data: row, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await uploadDocument({ supabase: supabase as any, groupId: 'group-1', input: fakeInput, docType: 'warranty', source: 'capture' });
    expect(env.putFile).not.toHaveBeenCalled();
    expect(supabase.__storageUpload).toHaveBeenCalled();
  });

  it('refuses a file over the Supabase cap when it can only go to Supabase', async () => {
    storageEnv({ provider: 'supabase' });
    const supabase = makeFakeSupabase({ insertResult: { data: row, error: null } });
    const big = { ...fakeInput, sizeBytes: SUPABASE_DOCUMENT_MAX_BYTES + 1 };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      uploadDocument({ supabase: supabase as any, groupId: 'group-1', input: big, docType: 'other', source: 'capture' })
    ).rejects.toThrow(/max 50 MB/);
    expect(supabase.__storageUpload).not.toHaveBeenCalled();
  });

  it('removes the R2 copy, not a Supabase object, when the row insert fails', async () => {
    const env = storageEnv({ provider: 'r2', url: 'https://r2/put' });
    const supabase = makeFakeSupabase({ insertResult: { data: null, error: { message: 'db down' } } });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      uploadDocument({ supabase: supabase as any, groupId: 'group-1', input: fakeInput, docType: 'other', source: 'capture' })
    ).rejects.toThrow(/could not save/i);
    expect(env.postJson).toHaveBeenLastCalledWith('/api/storage', expect.objectContaining({ op: 'delete', bucket: 'documents' }));
    expect(supabase.__storageRemove).not.toHaveBeenCalled();
  });
});

describe('signedDocumentUrl with R2', () => {
  afterEach(() => configureDocumentStorage(null));

  const supabaseSigning = () => ({
    storage: { from: () => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://supabase/signed' }, error: null })) }) },
  });

  it('returns the R2 link when the file has an R2 copy', async () => {
    configureDocumentStorage({ postJson: async () => ({ provider: 'r2', url: 'https://r2/get' }), putFile: async () => 200 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await signedDocumentUrl(supabaseSigning() as any, 'g/d/f.pdf')).toBe('https://r2/get');
  });

  it('uses the Supabase original when the server cannot be reached', async () => {
    configureDocumentStorage({ postJson: async () => { throw new Error('offline'); }, putFile: async () => 200 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await signedDocumentUrl(supabaseSigning() as any, 'g/d/f.pdf')).toBe('https://supabase/signed');
  });

  it('never asks the server about legacy buckets', async () => {
    const postJson = vi.fn(async () => ({ provider: 'r2', url: 'https://r2/get' }));
    configureDocumentStorage({ postJson, putFile: async () => 200 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await signedDocumentUrl(supabaseSigning() as any, 'g/x.pdf', 300, 'cost-documents')).toBe('https://supabase/signed');
    expect(postJson).not.toHaveBeenCalled();
  });
});

describe('registerDocument', () => {
  it('inserts a row pointing at an existing storage object without uploading', async () => {
    const row = { id: 'doc-2', group_id: 'group-1', storage_path: 'existing/path.png' };
    const supabase = makeFakeSupabase({ insertResult: { data: row, error: null } });
    const result = await registerDocument({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      groupId: 'group-1',
      storagePath: 'existing/path.png',
      filename: 'receipt.png',
      docType: 'receipt',
      source: 'grocery',
    });
    expect(result).toEqual(row);
    expect(supabase.__storageUpload).not.toHaveBeenCalled();
  });
});

// ── Module gates (module-features.ts) ────────────────────────────────────────
// Table-driven: switch each module off in turn; only the things that need it
// disappear.

const offEach = ALL_MODULE_IDS.map((off) => [off, new Set<string>(ALL_MODULE_IDS.filter((m) => m !== off))] as const);
const allOn = new Set<string>(ALL_MODULE_IDS);

/** A fake client whose every query resolves to the rows given for its table. */
function makeListingSupabase(rowsByTable: Record<string, unknown[]>) {
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      order: () => builder,
      then: (resolve: (r: QueryResult) => unknown) => resolve({ data: rowsByTable[table] ?? [], error: null }),
    };
    return builder;
  });
  return { from, tables };
}

const legacyRows = {
  cost_documents: [
    { id: 'cd-1', storage_path: 'g/bill.pdf', filename: 'bill.pdf', doc_type: 'bill', created_at: '2026-10-01', cost_item_id: 'cost-1' },
  ],
  grocery_sessions: [
    { id: 'gs-1', receipt_path: 'g/receipt.jpg', receipt_name: 'receipt.jpg', created_at: '2026-10-02' },
  ],
};

describe('listUnifiedDocuments legacy sources', () => {
  async function listWith(enabled: ReadonlySet<string>) {
    const supabase = makeListingSupabase(legacyRows);
    const docs = await listUnifiedDocuments(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'group-1',
      [],
      {
        costs: isFeatureEnabled('documents.costs', enabled),
        groceries: isFeatureEnabled('documents.groceries', enabled),
      }
    );
    return { keys: docs.map((d) => d.key).sort(), tables: supabase.tables };
  }

  it('merges both legacy silos when every module is on', async () => {
    const { keys } = await listWith(allOn);
    expect(keys).toEqual(['cost_documents:cd-1', 'grocery_sessions:gs-1']);
  });

  it('keeps both silos when the flags are left out', async () => {
    const supabase = makeListingSupabase(legacyRows);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = await listUnifiedDocuments(supabase as any, 'group-1', []);
    expect(docs.map((d) => d.key).sort()).toEqual(['cost_documents:cd-1', 'grocery_sessions:gs-1']);
  });

  it.each(offEach)('with %s off, drops only the silo that needs it and skips its query', async (off, enabled) => {
    const { keys, tables } = await listWith(enabled);
    const expected = [
      ...(off === 'costs' || off === 'documents' ? [] : ['cost_documents:cd-1']),
      ...(off === 'groceries' || off === 'documents' ? [] : ['grocery_sessions:gs-1']),
    ];
    expect(keys).toEqual(expected);
    expect(tables.includes('cost_documents')).toBe(expected.includes('cost_documents:cd-1'));
    expect(tables.includes('grocery_sessions')).toBe(expected.includes('grocery_sessions:gs-1'));
  });
});

describe('visibleDocumentLinks', () => {
  const links = [
    { entity_type: 'cost_item' as const },
    { entity_type: 'grocery_session' as const },
    { entity_type: 'setup_item' as const },
    { entity_type: 'event' as const },
    { entity_type: 'recipe' as const },
  ];
  const NEEDS: Record<string, string> = {
    cost_item: 'costs',
    grocery_session: 'groceries',
    setup_item: 'setup',
    event: 'calendar',
    recipe: 'recipes',
  };

  it('shows every link when every module is on', () => {
    const shown = visibleDocumentLinks(links, (id) => isFeatureEnabled(id, allOn));
    expect(shown.map((l) => l.entity_type)).toEqual(links.map((l) => l.entity_type));
  });

  // A chip only shows while its module is on, so it must open that module's
  // screen, never another module's (the route guard would bounce it Home).
  it.each(links)('a $entity_type link opens a screen of its own module', (link) => {
    expect(getModuleIdForPath(documentLinkHref({ ...link, entity_id: 'x-1' }))).toBe(NEEDS[link.entity_type]);
  });

  it.each(offEach)('with %s off, drops only the links into it', (off, enabled) => {
    const shown = visibleDocumentLinks(links, (id) => isFeatureEnabled(id, enabled)).map((l) => l.entity_type);
    const expected = links
      .map((l) => l.entity_type)
      .filter((t) => off !== 'documents' && NEEDS[t] !== off);
    expect(shown).toEqual(expected);
  });
});

describe('isCaptureCategoryEnabled', () => {
  const NEEDS: Record<CaptureCategoryId, string[]> = {
    document: ['documents'],
    other: ['documents'],
    invoice: ['costs', 'documents'],
    grocery: ['groceries'],
    apartment: ['search'],
  };
  const ids = Object.keys(CAPTURE_CATEGORY_FEATURES) as CaptureCategoryId[];

  it('offers every category when every module is on', () => {
    for (const id of ids) expect(isCaptureCategoryEnabled(id, (f) => isFeatureEnabled(f, allOn)), id).toBe(true);
  });

  it.each(offEach)('with %s off, hides only the categories that write into it', (off, enabled) => {
    for (const id of ids) {
      expect([id, isCaptureCategoryEnabled(id, (f) => isFeatureEnabled(f, enabled))]).toEqual([id, !NEEDS[id].includes(off)]);
    }
  });
});

describe('documentListSections', () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const docs = [
    { key: 'lease', expiryDate: inDays(200) },
    { key: 'passport', expiryDate: inDays(12) },
    { key: 'receipt', expiryDate: null },
    { key: 'rego', expiryDate: inDays(-3) },
  ];
  const keys = (s: { docs: { key: string }[] }) => s.docs.map((d) => d.key);

  it('pulls expired and soon documents into a leading section, keeping order', () => {
    const sections = documentListSections(docs, true);
    expect(sections.map((s) => [s.key, s.label])).toEqual([
      ['soon', 'Expiring soon'],
      ['files', 'Files'],
    ]);
    expect(keys(sections[0])).toEqual(['passport', 'rego']);
    expect(keys(sections[1])).toEqual(['lease', 'receipt']);
  });

  it('keeps one Files section when the split is off', () => {
    const sections = documentListSections(docs, false);
    expect(sections).toHaveLength(1);
    expect(keys(sections[0])).toEqual(['lease', 'passport', 'receipt', 'rego']);
  });

  it('drops empty sections', () => {
    expect(documentListSections([], true)).toEqual([]);
    expect(documentListSections([], false)).toEqual([]);
    expect(documentListSections([docs[0]], true).map((s) => s.key)).toEqual(['files']);
    expect(documentListSections([docs[1]], true).map((s) => s.key)).toEqual(['soon']);
  });
});

describe('documentExpiryCounts', () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  it('counts expired and expiring-soon documents apart, ignoring the rest', () => {
    expect(
      documentExpiryCounts([
        { expiryDate: inDays(-40) },
        { expiryDate: inDays(-1) },
        { expiryDate: inDays(5) },
        { expiryDate: inDays(90) },
        { expiryDate: null },
      ])
    ).toEqual({ soon: 1, expired: 2 });
  });
});
