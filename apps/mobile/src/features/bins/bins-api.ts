// Bin night: setup helpers that need the server, the native side of
// apps/web/src/lib/bins-api.ts. A council calendar photo (camera or library)
// or PDF goes to POST /api/parse-bins (AI); Home Assistant's Waste Collection
// Schedule is read through POST /api/bins/home-assistant. Both answer raw
// data, normalized here against the device's today.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { inferBinSetup, normalizeParsedBins, todayISO, type ParsedBinSetup } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export type BinSetupResult = { ok: true; setup: ParsedBinSetup } | { ok: false; error: string };

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const server = await getStoredServer();
    if (!server) return { ok: false, error: 'No server configured.' };
    const {
      data: { session },
    } = await getCurrentSupabaseClient().auth.getSession();
    const res = await fetch(`${server.origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? "Couldn't read that. Try again." };
    return { ok: true, data: data ?? {} };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

/** Picks the council calendar: a photo from the camera, or a photo or PDF from the files. Null when cancelled. */
async function pickCalendar(source: 'camera' | 'file'): Promise<{ dataUrl: string; pdf: boolean } | { error: string } | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { error: 'Rooftap needs the camera to read the calendar. Allow it in your phone settings.' };
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
    const asset = shot.canceled ? null : shot.assets?.[0];
    if (!asset) return null;
    const base64 = asset.base64 ?? (await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }));
    return { dataUrl: `data:${asset.mimeType ?? 'image/jpeg'};base64,${base64}`, pdf: false };
  }
  const picked = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
  const asset = picked.canceled ? null : picked.assets?.[0];
  if (!asset) return null;
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const mimeType = asset.mimeType ?? 'image/jpeg';
  return { dataUrl: `data:${mimeType};base64,${base64}`, pdf: mimeType === 'application/pdf' };
}

/** Reads a council calendar from a photo or PDF. Null when the picker was cancelled. */
export async function readCouncilCalendar(source: 'camera' | 'file'): Promise<BinSetupResult | null> {
  const picked = await pickCalendar(source);
  if (!picked) return null;
  if ('error' in picked) return { ok: false, error: picked.error };
  const res = await post('/api/parse-bins', picked.pdf ? { pdf: picked.dataUrl } : { images: [picked.dataUrl] });
  if (!res.ok) return res;
  const setup = normalizeParsedBins(res.data, todayISO());
  if (setup.streams.length === 0) return { ok: false, error: 'No bin days found there. Try a clearer photo, or enter them yourself.' };
  return { ok: true, setup };
}

export interface HomeAssistantBinCalendar {
  entityId: string;
  name: string;
}

export type HomeAssistantBinsResult =
  | { ok: true; setup: ParsedBinSetup; calendars: HomeAssistantBinCalendar[] }
  | { ok: false; error: string };

/** Reads bin days from Home Assistant: from `entityId`, or from the calendars that look like bin calendars. */
export async function readHomeAssistantBins(entityId?: string): Promise<HomeAssistantBinsResult> {
  const res = await post('/api/bins/home-assistant', entityId ? { entityId } : {});
  if (!res.ok) return res;
  const collections = Array.isArray(res.data.collections) ? (res.data.collections as { date: string; name: string }[]) : [];
  const calendars = Array.isArray(res.data.calendars) ? (res.data.calendars as HomeAssistantBinCalendar[]) : [];
  return { ok: true, setup: inferBinSetup(collections, todayISO()), calendars };
}
