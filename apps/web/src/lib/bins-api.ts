// Bin night: setup helpers that need the server. A council calendar photo or
// PDF goes to POST /api/parse-bins (AI); Home Assistant's Waste Collection
// Schedule is read through POST /api/bins/home-assistant. Both answer raw
// data, normalized here against the device's today.
// Native twin: apps/mobile/src/features/bins/bins-api.ts.
import { createBinsSetupApi, todayISO, type BinSetupResult, type BinsPost } from '@homeup/core';

export type { BinSetupResult, HomeAssistantBinCalendar, HomeAssistantBinsResult } from '@homeup/core';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

const post: BinsPost = async (path, body) => {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? "Couldn't read that. Try again." };
    return { ok: true, data: data ?? {} };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
};

const api = createBinsSetupApi(post, todayISO);

/** Reads a council calendar from a photo or PDF. */
export async function readCouncilCalendar(file: File): Promise<BinSetupResult> {
  const dataUrl = await readAsDataUrl(file);
  return api.readCouncilCalendar({ dataUrl, pdf: file.type === 'application/pdf' });
}

/** Reads bin days from Home Assistant: from `entityId`, or from the calendars that look like bin calendars. */
export const readHomeAssistantBins = api.readHomeAssistantBins;
