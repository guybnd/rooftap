import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncSession, uploadReceipt } from './grocery-sessions';
import type { DocumentUploadInput } from './documents';
import { ALL_MODULE_IDS, type ModuleId } from './modules';
import { resetModulesStore, setModuleRows } from './modules-store';
import type { GrocerySession } from './types';

function makeFakeSupabase(uploadError: { message: string } | null = null) {
  const storageUpload = vi.fn(() => Promise.resolve({ data: { path: 'x' }, error: uploadError }));
  return {
    storage: { from: vi.fn(() => ({ upload: storageUpload })) },
    __storageUpload: storageUpload,
  };
}

const fakeInput: DocumentUploadInput = {
  body: new Blob(['hello'], { type: 'image/jpeg' }),
  filename: 'receipt.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 5,
};

describe('uploadReceipt', () => {
  it('takes a platform-neutral DocumentUploadInput (no File) and uploads with contentType', async () => {
    const supabase = makeFakeSupabase();
    const result = await uploadReceipt(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'group-1',
      '2026-08-04',
      fakeInput
    );
    expect(result).toEqual({ path: expect.stringContaining('group-1/grocery-receipts/2026-08-04-'), name: 'receipt.jpg' });
    expect(supabase.__storageUpload).toHaveBeenCalledWith(
      expect.stringContaining('.jpg'),
      fakeInput.body,
      { upsert: true, contentType: 'image/jpeg' }
    );
  });

  it('falls back to a jpg extension when the filename has none', async () => {
    const supabase = makeFakeSupabase();
    const result = await uploadReceipt(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'group-1',
      '2026-08-04',
      { ...fakeInput, filename: 'receipt' }
    );
    expect(result?.path.endsWith('.jpg')).toBe(true);
  });

  it('returns null and does not throw when the storage upload fails', async () => {
    const supabase = makeFakeSupabase({ message: 'network blip' });
    const result = await uploadReceipt(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      'group-1',
      '2026-08-04',
      fakeInput
    );
    expect(result).toBeNull();
  });
});

// ── syncSession: the Groceries -> Costs write (costs.from-groceries) ──────────

const session: GrocerySession = {
  id: 'sess-1',
  group_id: 'group-1',
  session_date: '2026-10-18',
  summed_total_cents: 0,
  override_total_cents: null,
  receipt_total_cents: null,
  retailer: null,
  receipt_path: null,
  receipt_name: null,
  tracking: 'on',
  cost_item_id: null,
  closed_at: null,
  created_by: 'user-1',
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

/** A chainable Supabase stand-in that records every write by table. */
function makeSessionSupabase(linkedCostItemId: string | null = null) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  const from = (table: string) => {
    let op = 'select';
    let payload: unknown;
    const result = () => {
      if (table === 'cost_items' && op === 'insert') return { data: { id: 'cost-new' }, error: null };
      if (table === 'grocery_sessions' && op === 'update') return { data: { ...session, ...(payload as object) }, error: null };
      if (table === 'grocery_sessions') return { data: { cost_item_id: linkedCostItemId }, error: null };
      return { data: null, error: null };
    };
    const write = (nextOp: string) => (p?: unknown) => {
      op = nextOp;
      payload = p;
      writes.push({ table, op, payload: p });
      return builder;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      insert: write('insert'),
      update: write('update'),
      delete: write('delete'),
      eq: () => builder,
      in: () => builder,
      single: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    };
    return builder;
  };
  return {
    writes,
    client: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) }, from },
  };
}

function allOnBut(off: ModuleId | null) {
  return ALL_MODULE_IDS.map((module_id) => ({
    group_id: 'group-1',
    module_id,
    enabled: module_id !== off,
    updated_by: null,
    updated_at: '2026-10-18T00:00:00.000Z',
  }));
}

describe('syncSession', () => {
  afterEach(() => resetModulesStore());

  it.each([
    { writeCostLine: true, costWrites: 1, link: 'cost-new' },
    { writeCostLine: false, costWrites: 0, link: undefined },
  ])('writeCostLine=$writeCostLine -> $costWrites cost line write(s)', async ({ writeCostLine, costWrites, link }) => {
    const { client, writes } = makeSessionSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await syncSession(client as any, session, 'group-1', 1250, writeCostLine);
    expect(writes.filter((w) => w.table === 'cost_items')).toHaveLength(costWrites);
    expect(writes.filter((w) => w.table === 'cost_documents')).toHaveLength(0);
    // The trip's own total is kept either way; only the link depends on Costs.
    const sessionPatch = writes.find((w) => w.table === 'grocery_sessions' && w.op === 'update')?.payload as Record<string, unknown>;
    expect(sessionPatch.summed_total_cents).toBe(1250);
    expect(sessionPatch.cost_item_id).toBe(link);
    expect(updated.summed_total_cents).toBe(1250);
  });

  // Costs off never adds a line, but one the trip already has stays right, so
  // Costs is correct when it comes back.
  it('keeps an existing cost line in sync while Costs is off', async () => {
    const { client, writes } = makeSessionSupabase('cost-old');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncSession(client as any, { ...session, cost_item_id: 'cost-old' }, 'group-1', 4000, false);
    const costWrites = writes.filter((w) => w.table === 'cost_items');
    expect(costWrites.map((w) => w.op)).toEqual(['update']);
    expect((costWrites[0].payload as Record<string, unknown>).amount).toBe(4000);
    const sessionPatch = writes.find((w) => w.table === 'grocery_sessions' && w.op === 'update')?.payload as Record<string, unknown>;
    expect(sessionPatch.cost_item_id).toBeUndefined();
  });

  it('removes an existing cost line at $0 while Costs is off', async () => {
    const { client, writes } = makeSessionSupabase('cost-old');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncSession(client as any, { ...session, cost_item_id: 'cost-old' }, 'group-1', 0, false);
    expect(writes.filter((w) => w.table === 'cost_items').map((w) => w.op)).toEqual(['delete']);
    const sessionPatch = writes.find((w) => w.table === 'grocery_sessions' && w.op === 'update')?.payload as Record<string, unknown>;
    expect(sessionPatch.cost_item_id).toBeNull();
  });

  it('adds no line while Costs is off when another member unlinked it', async () => {
    const { client, writes } = makeSessionSupabase(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncSession(client as any, { ...session, cost_item_id: 'cost-old' }, 'group-1', 4000, false);
    expect(writes.filter((w) => w.table === 'cost_items')).toHaveLength(0);
  });

  // Callers that don't pass the flag (capture flows) follow the household's switches.
  it.each([null, ...ALL_MODULE_IDS])('defaults to the household switches: %s off', async (off) => {
    setModuleRows(allOnBut(off as ModuleId | null));
    const { client, writes } = makeSessionSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncSession(client as any, session, 'group-1', 1250);
    const expected = off === 'costs' || off === 'groceries' ? 0 : 1;
    expect(writes.filter((w) => w.table === 'cost_items')).toHaveLength(expected);
  });

  it('writes the cost line before the switches have loaded (unknown = every module on)', async () => {
    const { client, writes } = makeSessionSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncSession(client as any, session, 'group-1', 1250);
    expect(writes.filter((w) => w.table === 'cost_items')).toHaveLength(1);
  });
});
