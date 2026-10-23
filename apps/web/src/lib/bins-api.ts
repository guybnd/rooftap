// Bin night: setup helpers that need the server. A council calendar photo or
// PDF goes to POST /api/parse-bins (AI); Home Assistant's Waste Collection
// Schedule is read through POST /api/bins/home-assistant. Both answer raw
// data, normalized here against the device's today.
// Native twin: apps/mobile/src/features/bins/bins-api.ts.
import { inferBinSetup, normalizeParsedBins, todayISO, type ParsedBinSetup } from '@homeup/core';

export type BinSetupResult = { ok: true; setup: ParsedBinSetup } | { ok: false; error: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? "Couldn't read that. Try again." };
    return { ok: true, data: data ?? {} };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

/** Reads a council calendar from a photo or PDF. */
export async function readCouncilCalendar(file: File): Promise<BinSetupResult> {
  const dataUrl = await readAsDataUrl(file);
  const body = file.type === 'application/pdf' ? { pdf: dataUrl } : { images: [dataUrl] };
  const res = await post('/api/parse-bins', body);
  if (!res.ok) return res;
  const setup = normalizeParsedBins(res.data, todayISO());
  if (setup.streams.length === 0) return { ok: false, error: "No bin days found there. Try a clearer photo, or enter them yourself." };
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
