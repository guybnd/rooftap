import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apartmentPhotoUrl, uploadApartmentPhoto } from './photos';

function fakeSupabase(uploadError: unknown = null) {
  const upload = vi.fn(() => Promise.resolve({ error: uploadError }));
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const client = {
    storage: {
      from: vi.fn(() => ({
        upload,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
      })),
    },
    from: vi.fn(() => ({ insert })),
  };
  return { client: client as unknown as SupabaseClient, upload, insert };
}

describe('apartmentPhotoUrl', () => {
  it('passes legacy absolute URLs through and resolves bucket paths', () => {
    const { client } = fakeSupabase();
    expect(apartmentPhotoUrl(client, { storage_path: 'https://old/x.jpg' })).toBe('https://old/x.jpg');
    expect(apartmentPhotoUrl(client, { storage_path: 'u/a/x.jpg' })).toBe('https://cdn/u/a/x.jpg');
  });
});

describe('uploadApartmentPhoto', () => {
  const opts = { userId: 'u', apartmentId: 'a', filename: 'x.jpg', body: new Uint8Array(1), contentType: 'image/jpeg', room: '', isMain: true };

  it('stores under user/apartment and records the row with an empty room as null', async () => {
    const { client, upload, insert } = fakeSupabase();
    expect(await uploadApartmentPhoto(client, opts)).toBe(true);
    expect(upload).toHaveBeenCalledWith('u/a/x.jpg', opts.body, { contentType: 'image/jpeg' });
    expect(insert).toHaveBeenCalledWith({ apartment_id: 'a', storage_path: 'u/a/x.jpg', room: null, is_main: true });
  });

  it('records nothing when the upload fails', async () => {
    const { client, insert } = fakeSupabase({ message: 'quota' });
    expect(await uploadApartmentPhoto(client, opts)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});
