// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Document } from '../../types';

const list = vi.fn(async () => []);
vi.mock('./documents', async (orig) => ({ ...(await orig<typeof import('./documents')>()), listUnifiedDocuments: (...a: unknown[]) => list(...(a as [])) }));

const { documentsSearchSource } = await import('./slots');

const row = { id: 'd1', updated_at: '2026-11-01T00:00:00Z' } as Document;

describe('documents search source', () => {
  it('fetches once when the same rows arrive as a new array on every render', async () => {
    const supabase = {} as SupabaseClient;
    const { result, rerender } = renderHook(() =>
      documentsSearchSource.useHits({ groupId: 'g1', active: true, supabase, documentStoreRows: [{ ...row }] })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(list).toHaveBeenCalledTimes(1);
  });
});
