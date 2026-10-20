// HOUP-94: thin web facade over @homeup/core's `uploadReceipt` — mirrors the
// `File → DocumentUploadInput` adapter apps/web/src/lib/documents.ts already
// applies to `uploadDocument` (HOUP-83), so grocery capture call sites
// (capture-sheet.tsx, grocery-session-panel.tsx) keep their `file: File`
// signature unchanged while core stays platform-neutral for native.
//
// Every other grocery-session helper (fetchTodaySession, ensureSession,
// updateSession, syncSession, applyReceiptLearning, etc.) is platform-neutral
// already and is imported straight from '@homeup/core' at call sites — only
// `uploadReceipt` needs a facade.

import { uploadReceipt as coreUploadReceipt, type DocumentUploadInput } from '@homeup/core';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function uploadReceipt(
  supabase: SupabaseClient,
  groupId: string,
  sessionDate: string,
  file: File
): Promise<{ path: string; name: string } | null> {
  const input: DocumentUploadInput = {
    body: file,
    filename: file.name,
    mimeType: file.type || null,
    sizeBytes: file.size,
  };
  return coreUploadReceipt(supabase, groupId, sessionDate, input);
}
