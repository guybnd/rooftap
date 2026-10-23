import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apartmentPhotoPath, apartmentPhotoUrls, uploadApartmentPhoto } from './photos';

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

describe('apartmentPhotoPath', () => {
  it('keeps bucket paths, maps this bucket\'s own URLs back to paths, and leaves other URLs alone', () => {
    expect(apartmentPhotoPath('u/a/x.jpg')).toBe('u/a/x.jpg');
    expect(apartmentPhotoPath('https://s.example/storage/v1/object/public/apartment-photos/pdf-extracts/1.jpg')).toBe('pdf-extracts/1.jpg');
    expect(apartmentPhotoPath('https://s.example/storage/v1/object/sign/apartment-photos/pdf-extracts/2.jpg?token=abc')).toBe('pdf-extracts/2.jpg');
    expect(apartmentPhotoPath('https://s.example/storage/v1/object/public/documents/x.pdf')).toBeNull();
    expect(apartmentPhotoPath('https://listing.example/img/x.jpg')).toBeNull();
  });
});

describe('apartmentPhotoUrls', () => {
  function signingClient(signed: { path: string; signedUrl: string; error: string | null }[]) {
    const createSignedUrls = vi.fn(async () => ({ data: signed, error: null }));
    const client = {
      storage: {
        from: () => ({
          createSignedUrls,
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
        }),
      },
    } as unknown as SupabaseClient;
    return { client, createSignedUrls };
  }

  it('signs bucket files once each, in order, and passes external URLs through', async () => {
    const { client, createSignedUrls } = signingClient([
      { path: 'u/a/x.jpg', signedUrl: 'https://signed/x', error: null },
      { path: 'pdf-extracts/1.jpg', signedUrl: 'https://signed/1', error: null },
    ]);
    const urls = await apartmentPhotoUrls(client, [
      { storage_path: 'https://listing.example/a.jpg' },
      { storage_path: 'u/a/x.jpg' },
      { storage_path: 'https://s/storage/v1/object/public/apartment-photos/pdf-extracts/1.jpg' },
      { storage_path: 'u/a/x.jpg' },
    ]);
    expect(urls).toEqual(['https://listing.example/a.jpg', 'https://signed/x', 'https://signed/1', 'https://signed/x']);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['u/a/x.jpg', 'pdf-extracts/1.jpg'], 3600);
  });

  it('falls back to the public URL when a file fails to sign, and skips signing when nothing needs it', async () => {
    const { client, createSignedUrls } = signingClient([{ path: 'u/a/x.jpg', signedUrl: '', error: 'Object not found' }]);
    expect(await apartmentPhotoUrls(client, [{ storage_path: 'u/a/x.jpg' }])).toEqual(['https://cdn/u/a/x.jpg']);
    createSignedUrls.mockClear();
    expect(await apartmentPhotoUrls(client, [{ storage_path: 'https://listing.example/a.jpg' }])).toEqual(['https://listing.example/a.jpg']);
    expect(createSignedUrls).not.toHaveBeenCalled();
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
