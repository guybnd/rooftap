'use client';

// Writes the server refused for good, kept so the app can say so. A refused
// write is dropped from the Legend outbox (create-group-store.ts), so the
// row stays on this device but never reaches the server. Without this list
// the only trace was a console warning.

import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

export interface WriteFailure {
  /** Supabase table of the refused row, e.g. `household_tasks`. */
  collection: string;
  id: string;
  message: string;
  at: number;
}

const MAX_KEPT = 20;

export const writeFailures$ = observable<WriteFailure[]>([]);

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return String(error ?? 'Unknown error');
}

export function reportWriteFailure(collection: string, id: string, error: unknown): void {
  const failure: WriteFailure = { collection, id: String(id), message: errorMessage(error), at: Date.now() };
  writeFailures$.set((list) =>
    [...list.filter((f) => !(f.collection === collection && f.id === failure.id)), failure].slice(-MAX_KEPT),
  );
}

export function dismissWriteFailures(): void {
  writeFailures$.set([]);
}

export function useWriteFailures(): WriteFailure[] {
  return use$(() => writeFailures$.get());
}
