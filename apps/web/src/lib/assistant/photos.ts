import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_PHOTOS_BUCKET, assistantPhotoPath, expiredPhotoDays } from "@homeup/core";
import type { ChatImage } from "./llm";

// Photos in Assistant chats, on the server (core assistant-photos.ts has the
// shared rules). The bucket is private with no storage policies, so all of
// it goes through the service role here: upload slots under the person's
// household, shrinking a photo before the model sees it, short-lived links
// for the apps, and deleting photos past the keep time.

/** Longest edge the model gets. Anthropic shrinks anything larger anyway, and it keeps tokens and storage down. */
export const MODEL_PHOTO_EDGE = 1568;

/** A JPEG at most this size, already within the edge, goes to the model as it is. */
const ALREADY_SMALL_BYTES = 1_500_000;

/** How long a link to show a photo lasts. The apps fetch new ones with each load. */
export const PHOTO_URL_TTL_SECONDS = 60 * 60;

/** A one-time upload slot for a new photo in this person's household. */
export async function createPhotoSlot(admin: SupabaseClient, groupId: string, userId: string, mimeType: string, now = new Date()) {
  const path = assistantPhotoPath(groupId, userId, crypto.randomUUID(), mimeType, now);
  const { data, error } = await admin.storage.from(ASSISTANT_PHOTOS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not make an upload slot");
  return { path, token: data.token };
}

/** Turns a photo the right way up and shrinks it to the model's size, as JPEG. */
export async function shrinkPhoto(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({ width: MODEL_PHOTO_EDGE, height: MODEL_PHOTO_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function download(admin: SupabaseClient, path: string): Promise<Blob | null> {
  const { data, error } = await admin.storage.from(ASSISTANT_PHOTOS_BUCKET).download(path);
  return error || !data ? null : data;
}

/**
 * The photos sent with this message, ready for the model. Each is shrunk
 * once and the small copy replaces the upload, so the bucket keeps only
 * what the model saw. Null when one of them isn't there (the upload never
 * finished).
 */
export async function preparePhotos(admin: SupabaseClient, paths: readonly string[]): Promise<ChatImage[] | null> {
  const images = await Promise.all(
    paths.map(async (path) => {
      const blob = await download(admin, path);
      if (!blob) return null;
      const small = await shrinkPhoto(Buffer.from(await blob.arrayBuffer()));
      const { error } = await admin.storage.from(ASSISTANT_PHOTOS_BUCKET).upload(path, small, { contentType: "image/jpeg", upsert: true });
      if (error) console.warn("[assistant] could not replace a photo with its small copy", error.message);
      return { mimeType: "image/jpeg", data: small.toString("base64") };
    })
  );
  return images.every((i): i is ChatImage => i !== null) ? images : null;
}

/** Photos sent earlier and still kept, for the model to look at again. A photo no longer kept is left out. */
export async function loadKeptPhotos(admin: SupabaseClient, paths: readonly string[]): Promise<ChatImage[]> {
  const images = await Promise.all(
    paths.map(async (path) => {
      const blob = await download(admin, path);
      if (!blob) return null;
      const bytes = Buffer.from(await blob.arrayBuffer());
      const ready = blob.type === "image/jpeg" && bytes.length <= ALREADY_SMALL_BYTES ? bytes : await shrinkPhoto(bytes);
      return { mimeType: "image/jpeg", data: ready.toString("base64") };
    })
  );
  return images.filter((i): i is ChatImage => i !== null);
}

/** Short-lived links to show photos, by path. A photo no longer kept has none. */
export async function photoUrls(admin: SupabaseClient, paths: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data } = await admin.storage.from(ASSISTANT_PHOTOS_BUCKET).createSignedUrls(unique, PHOTO_URL_TTL_SECONDS);
  for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  return out;
}

/** Copies a chat photo, as stored, for filing elsewhere (Documents). */
export async function photoBytes(admin: SupabaseClient, path: string): Promise<Buffer | null> {
  const blob = await download(admin, path);
  return blob ? Buffer.from(await blob.arrayBuffer()) : null;
}

/** Deletes a household's photos older than its keep time, a whole day folder at a time. */
export async function sweepOldPhotos(admin: SupabaseClient, groupId: string, keepDays: number, now = new Date()): Promise<number> {
  const bucket = admin.storage.from(ASSISTANT_PHOTOS_BUCKET);
  const { data: days } = await bucket.list(groupId, { limit: 1000 });
  let removed = 0;
  for (const dayFolder of expiredPhotoDays((days ?? []).map((d) => d.name), keepDays, now)) {
    const prefix = `${groupId}/${dayFolder}`;
    const { data: files } = await bucket.list(prefix, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length === 0) continue;
    const { error } = await bucket.remove(paths);
    if (!error) removed += paths.length;
  }
  return removed;
}
