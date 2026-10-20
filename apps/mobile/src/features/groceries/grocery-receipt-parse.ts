// HOUP-226: native call to POST /api/parse-receipt (apps/web/src/app/api/
// parse-receipt/route.ts), mirroring apps/web/src/lib/grocery-receipt-parse.ts.
// Same authedFetch pattern as apps/mobile/src/features/homesearch/
// parse-listing-api.ts: an absolute-origin fetch with the current Supabase
// session's access token as `Authorization: Bearer` — the route's
// getSessionUser() accepts this as a fallback to the cookie path (HOUP-216).
import type { ParsedReceipt } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');

  const supabase = getCurrentSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return fetch(`${server.origin}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init?.headers,
    },
  });
}

/** Parse a receipt image/PDF (as a base64 data URL) via the server OCR endpoint. */
export async function parseReceiptFile(dataUrl: string, mimeType: string | null): Promise<ParsedReceipt | null> {
  try {
    const body = mimeType === 'application/pdf' ? { pdf: dataUrl } : { images: [dataUrl] };
    const res = await authedFetch('/api/parse-receipt', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
      console.error('parse-receipt failed:', res.status);
      return null;
    }
    return (await res.json()) as ParsedReceipt;
  } catch (err) {
    console.error('parseReceiptFile failed:', err);
    return null;
  }
}
