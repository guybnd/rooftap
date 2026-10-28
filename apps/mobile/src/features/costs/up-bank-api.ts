// Up Bank connector: native calls to /api/up-bank, through core's shared client
// so request shapes match web. Same authed pattern as
// features/shopper/shopper-api.ts: the server origin plus the Supabase
// session as `Authorization: Bearer`.
// Web twin: apps/web/src/lib/up-bank-client.ts.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { createBankImportApi, createUpBankApi, type UpBankCall } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

/** Reading Up can take a while on the first connect (90 days of transactions). */
const WAIT_MS = 45_000;

const call: UpBankCall = async (path, init) => {
  const server = await getStoredServer();
  if (!server) throw new Error('No server configured.');
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAIT_MS);
  let res: Response;
  try {
    res = await fetch(`${server.origin}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new Error("Couldn't reach Rooftap. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as never;
};

export const upBankApi = createUpBankApi(call);

/** Bank statement import (/api/bank-import), on the same call. */
export const bankImportApi = createBankImportApi(call);

/** Picks a CSV statement and reads its text on the device. Null when the picker was cancelled. */
export async function pickStatementFile(): Promise<{ name: string; text: string } | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? null : picked.assets?.[0];
  if (!asset) return null;
  return { name: asset.name, text: await FileSystem.readAsStringAsync(asset.uri) };
}
