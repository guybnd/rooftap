// Photos in Assistant chats: a person attaches a photo (a receipt, a bin
// calendar, a recipe page) and the Assistant reads it and files what it finds
// with its tools. The photo goes to a private storage bucket that no app can
// read or write directly: the server hands out a one-time upload slot under
// the household's folder, signs short-lived links to show it, and deletes it
// after the household's keep time.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntitlementTier } from '../../entitlements';

export const ASSISTANT_PHOTOS_BUCKET = 'assistant-photos';

/** The Assistant's tool that files a chat photo in Documents, so it outlives the keep time. */
export const FILE_PHOTO_TOOL = 'file_photo';

/** Photos one message may carry. */
export const MAX_ASSISTANT_PHOTOS = 4;

/** The largest photo an app may upload (the bucket's own limit). The server shrinks it before the model sees it. */
export const ASSISTANT_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const ASSISTANT_PHOTO_MAX_LABEL = '20 MB';

export const ASSISTANT_PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Days a chat photo is kept before it is deleted (a copy filed to Documents
 * stays). One number for every plan today; the plan is passed so a paid
 * hosted plan can keep them longer than a free one.
 */
export function assistantPhotoKeepDays(_tier: EntitlementTier): number {
  return 30;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Where a new photo goes: `<group>/<YYYY-MM-DD>/<user>-<id>.<ext>`. The day
 * folder lets the server delete whole days once they pass the keep time.
 */
export function assistantPhotoPath(groupId: string, userId: string, id: string, mimeType: string, now: Date = new Date()): string {
  return `${groupId}/${day(now)}/${userId}-${id}.${EXT[mimeType] ?? 'jpg'}`;
}

const PATH = /^([0-9a-f-]{36})\/(\d{4}-\d{2}-\d{2})\/([0-9a-f-]{36})-[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

/** Whether `path` is a photo this person uploaded for this household (so a message can't point at anyone else's). */
export function isAssistantPhotoPathFor(path: unknown, groupId: string, userId: string): path is string {
  if (typeof path !== 'string') return false;
  const m = PATH.exec(path);
  return !!m && m[1] === groupId && m[3] === userId;
}

/** The day folders in a household's photos that are past the keep time. */
export function expiredPhotoDays(folders: readonly string[], keepDays: number, now: Date = new Date()): string[] {
  const cutoff = day(new Date(now.getTime() - keepDays * 86_400_000));
  return folders.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f < cutoff);
}

/** A photo on a message as the apps get it: a short-lived link, or null once it is no longer kept. */
export interface AssistantPhoto {
  url: string | null;
}

/** An upload slot from /api/assistant/photos. */
export interface AssistantPhotoSlot {
  path: string;
  token: string;
}

/**
 * Uploads one photo into the slot the server handed out. `body` is the file
 * (web: a File or Blob; native: an ArrayBuffer read from disk). Resolves
 * with the path to send with the message.
 */
export async function uploadAssistantPhoto(
  supabase: SupabaseClient,
  slot: AssistantPhotoSlot,
  body: Blob | ArrayBuffer,
  mimeType: string
): Promise<string> {
  const { error } = await supabase.storage.from(ASSISTANT_PHOTOS_BUCKET).uploadToSignedUrl(slot.path, slot.token, body, { contentType: mimeType });
  if (error) throw new Error('Could not upload the photo. Try again.');
  return slot.path;
}

/** A file's type as the bucket expects it (some phones say image/jpg). */
export function assistantPhotoType(type: string | null | undefined): string | null {
  const t = (type ?? '').toLowerCase();
  return t === 'image/jpg' ? 'image/jpeg' : t || null;
}

/** Why a picked file can't be attached, or null when it can. */
export function assistantPhotoProblem(file: { type?: string | null; size?: number | null }): string | null {
  const type = assistantPhotoType(file.type);
  if (!type || !ASSISTANT_PHOTO_TYPES.includes(type)) return 'Attach a photo (JPEG, PNG, WebP or GIF).';
  if (file.size != null && file.size > ASSISTANT_PHOTO_MAX_BYTES) return `That photo is too large (max ${ASSISTANT_PHOTO_MAX_LABEL}).`;
  return null;
}
