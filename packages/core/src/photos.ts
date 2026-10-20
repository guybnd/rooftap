// Apartment photo data access, shared by web's components/photo-gallery.tsx
// and mobile's features/homesearch/photo-gallery.tsx. Both used to run these
// same `photos` table / `apartment-photos` bucket queries inline. Picking,
// compressing and reading files stays per platform; callers hand in the
// upload body.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Photo } from './types';

export const APARTMENT_PHOTO_BUCKET = 'apartment-photos';

type UploadBody = Parameters<ReturnType<SupabaseClient['storage']['from']>['upload']>[1];

/** Public URL for a photo. Legacy rows store a full http(s) URL instead of a bucket path. */
export function apartmentPhotoUrl(supabase: SupabaseClient, photo: Pick<Photo, 'storage_path'>): string {
  if (photo.storage_path.startsWith('http')) return photo.storage_path;
  return supabase.storage.from(APARTMENT_PHOTO_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl;
}

/** An apartment's photos, main photo first then oldest first, with their URLs keyed by photo id. */
export async function listApartmentPhotos(
  supabase: SupabaseClient,
  apartmentId: string,
): Promise<{ photos: Photo[]; urls: Record<string, string> } | null> {
  const { data } = await supabase
    .from('photos')
    .select('*')
    .eq('apartment_id', apartmentId)
    .order('is_main', { ascending: false })
    .order('created_at', { ascending: true });
  if (!data) return null;
  const photos = data as Photo[];
  const urls: Record<string, string> = {};
  for (const photo of photos) urls[photo.id] = apartmentPhotoUrl(supabase, photo);
  return { photos, urls };
}

/**
 * Upload one file to `<userId>/<apartmentId>/<filename>` and record it.
 * Returns false when the storage upload fails (nothing is recorded then).
 */
export async function uploadApartmentPhoto(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    apartmentId: string;
    filename: string;
    body: UploadBody;
    contentType: string;
    room: string | null;
    isMain: boolean;
  },
): Promise<boolean> {
  const storagePath = `${opts.userId}/${opts.apartmentId}/${opts.filename}`;
  const { error } = await supabase.storage
    .from(APARTMENT_PHOTO_BUCKET)
    .upload(storagePath, opts.body, { contentType: opts.contentType });
  if (error) return false;
  await supabase.from('photos').insert({
    apartment_id: opts.apartmentId,
    storage_path: storagePath,
    room: opts.room || null,
    is_main: opts.isMain,
  });
  return true;
}

/** Remove a photo's stored file (when it has one) and its row. Returns false if the row delete failed. */
export async function deleteApartmentPhoto(supabase: SupabaseClient, photo: Photo): Promise<boolean> {
  if (!photo.storage_path.startsWith('http')) {
    await supabase.storage.from(APARTMENT_PHOTO_BUCKET).remove([photo.storage_path]);
  }
  const { error } = await supabase.from('photos').delete().eq('id', photo.id);
  return !error;
}

/**
 * Make `photo` the apartment's main photo. Clears the current main first; if
 * setting the new one fails, the previous main is restored. Returns whether
 * the new main was set.
 */
export async function setMainApartmentPhoto(
  supabase: SupabaseClient,
  apartmentId: string,
  photo: Photo,
  previousMain: Photo | undefined,
): Promise<boolean> {
  const { error: clearErr } = await supabase
    .from('photos')
    .update({ is_main: false })
    .eq('apartment_id', apartmentId)
    .eq('is_main', true);
  if (clearErr) return false;
  const { error: setErr } = await supabase.from('photos').update({ is_main: true }).eq('id', photo.id);
  if (setErr && previousMain) {
    await supabase.from('photos').update({ is_main: true }).eq('id', previousMain.id);
  }
  return !setErr;
}

/** Tag a photo with a room; an empty room clears the tag. */
export async function updateApartmentPhotoRoom(supabase: SupabaseClient, photoId: string, room: string): Promise<void> {
  await supabase.from('photos').update({ room: room || null }).eq('id', photoId);
}
