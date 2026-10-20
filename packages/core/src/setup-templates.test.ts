import { describe, expect, it, vi } from 'vitest';
import { seedTemplateItems, SETUP_TEMPLATES } from './setup-templates';

function makeFakeSupabase(opts: { existingCount: number }) {
  let insertedRows: unknown[] = [];
  const insertMock = vi.fn((rows: unknown[]) => {
    insertedRows = rows;
    return builder;
  });
  const builder: Record<string, unknown> = {
    select: vi.fn((_cols?: string, selectOpts?: { count?: string; head?: boolean }) => {
      if (selectOpts?.head) {
        // Count query chain: select(...).eq(...).not(...) resolves to { count }.
        const countBuilder: Record<string, unknown> = {
          eq: vi.fn(() => countBuilder),
          not: vi.fn(() => Promise.resolve({ count: opts.existingCount })),
        };
        return countBuilder;
      }
      // Post-insert .select() resolves to the inserted rows.
      return Promise.resolve({ data: insertedRows, error: null });
    }),
    insert: insertMock,
  };
  const from = vi.fn((table: string) => {
    if (table !== 'setup_items') throw new Error(`unexpected table ${table}`);
    return builder;
  });
  return {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })) },
    from,
  } as unknown as Parameters<typeof seedTemplateItems>[1];
}

describe('seedTemplateItems', () => {
  it('inserts every template item when none are seeded yet', async () => {
    const supabase = makeFakeSupabase({ existingCount: 0 });
    const count = await seedTemplateItems('group-1', supabase);
    expect(count).toBe(SETUP_TEMPLATES.length);
  });

  it('is idempotent — skips insert when template rows already exist', async () => {
    const supabase = makeFakeSupabase({ existingCount: 3 });
    const count = await seedTemplateItems('group-1', supabase);
    expect(count).toBe(0);
    expect((supabase.from('setup_items') as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
  });
});
