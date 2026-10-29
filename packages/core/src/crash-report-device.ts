'use client';

// The device's side of crash reports (crash-report.ts): the "Send crash
// reports" switch, the crashes this device already sent, and reports kept
// for later when the server can't be reached. All of it is per device
// (deviceKeyValue), like the navigation speed. On until switched off.
import { useSyncExternalStore } from 'react';
import { deviceKeyValue } from './data/store-environment';
import type { CrashReceipt, CrashReport } from './crash-report';

const ENABLED_KEY = 'homeup-crash-reports';
const SENT_KEY = 'homeup-crash-sent';
const PENDING_KEY = 'homeup-crash-pending';

/** A device sends the same crash again only after this long. */
export const CRASH_RESEND_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many reports a day from one device. */
export const CRASH_DEVICE_DAILY_MAX = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_MAX = 5;

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return deviceKeyValue()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    deviceKeyValue()?.setItem(key, value);
  } catch {
    // Store unavailable: nothing is remembered, which only means a repeat may be sent.
  }
}

export function crashReportsEnabled(): boolean {
  return read(ENABLED_KEY) !== 'off';
}

export function setCrashReportsEnabled(on: boolean): void {
  write(ENABLED_KEY, on ? 'on' : 'off');
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The device's "Send crash reports" switch. */
export function useCrashReportsEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, crashReportsEnabled, () => true);
  return [on, setCrashReportsEnabled];
}

/** Signature to when this device last sent it, without entries past the resend window. */
export function sentCrashes(now: number): Record<string, number> {
  try {
    const raw = JSON.parse(read(SENT_KEY) ?? '{}') as Record<string, unknown>;
    const fresh: Record<string, number> = {};
    for (const [sig, at] of Object.entries(raw)) {
      if (typeof at === 'number' && now - at < CRASH_RESEND_MS) fresh[sig] = at;
    }
    return fresh;
  } catch {
    return {};
  }
}

function markSent(signature: string, now: number): void {
  write(SENT_KEY, JSON.stringify({ ...sentCrashes(now), [signature]: now }));
}

function pending(): CrashReport[] {
  try {
    const list = JSON.parse(read(PENDING_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as CrashReport[]) : [];
  } catch {
    return [];
  }
}

function keep(report: CrashReport): void {
  const list = pending().filter((r) => r.signature !== report.signature);
  write(PENDING_KEY, JSON.stringify([...list, report].slice(-PENDING_MAX)));
}

/** What happened to a report: the server's answer, or why it wasn't sent. */
export type CrashOutcome = CrashReceipt | 'known' | 'off' | 'kept' | 'skipped';

/** Sends one report; throws on a network error, answers null when the server can't take reports. */
export type CrashSender = (report: CrashReport) => Promise<CrashReceipt | null>;

/**
 * Sends a report unless this device switched reports off, already sent this
 * crash in the last week, or sent its daily share. A network error keeps the
 * report for sendKeptCrashes when `keepOffline` is set. `byHand` is the
 * person tapping send with reports switched off.
 */
export async function reportCrash(
  report: CrashReport,
  send: CrashSender,
  opts: { keepOffline?: boolean; byHand?: boolean; now?: number } = {}
): Promise<CrashOutcome> {
  if (!opts.byHand && !crashReportsEnabled()) return 'off';
  const now = opts.now ?? Date.now();
  const sent = sentCrashes(now);
  if (report.signature in sent) return 'known';
  if (Object.values(sent).filter((at) => now - at < DAY_MS).length >= CRASH_DEVICE_DAILY_MAX) return 'skipped';
  try {
    const receipt = await send(report);
    if (!receipt) return 'skipped';
    markSent(report.signature, now);
    return receipt;
  } catch {
    if (!opts.keepOffline) return 'skipped';
    keep(report);
    return 'kept';
  }
}

/** Sends the reports kept while offline; the ones that fail again stay kept. */
export async function sendKeptCrashes(send: CrashSender, now = Date.now()): Promise<void> {
  const list = pending();
  if (list.length === 0) return;
  write(PENDING_KEY, '[]');
  for (const report of list) await reportCrash(report, send, { keepOffline: true, now });
}
