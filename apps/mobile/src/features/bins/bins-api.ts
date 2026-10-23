// Bin night: setup helpers that need the server, the native side of
// apps/web/src/lib/bins-api.ts. A council calendar photo (camera or library)
// or PDF goes to POST /api/parse-bins (AI); Home Assistant's Waste Collection
// Schedule is read through POST /api/bins/home-assistant. Both answer raw
// data, normalized here against the device's today.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { createBinsSetupApi, todayISO, type BinSetupResult, type BinsPost } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

export type { BinSetupResult, HomeAssistantBinCalendar, HomeAssistantBinsResult } from '@homeup/core';

const post: BinsPost = async (path, body) => {
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
};

const api = createBinsSetupApi(post, todayISO);

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
  return api.readCouncilCalendar(picked);
}

/** Reads bin days from Home Assistant: from `entityId`, or from the calendars that look like bin calendars. */
export const readHomeAssistantBins = api.readHomeAssistantBins;
