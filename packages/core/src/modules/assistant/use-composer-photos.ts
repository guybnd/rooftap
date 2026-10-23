'use client';

// The photos attached in an Assistant composer, shared by web and native.
// Each photo uploads as soon as it is picked (into a slot the server hands
// out), so Send only waits on the ones still going up. Each platform brings
// its own picker and its own way to read the file.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantApi } from './assistant-api';
import type { OutgoingPhoto } from './assistant-thread';
import { MAX_ASSISTANT_PHOTOS, assistantPhotoProblem, assistantPhotoType, uploadAssistantPhoto } from './assistant-photos';

/** A photo the platform picked: a picture to show, and how to read its bytes. */
export interface PickedPhoto {
  preview: string;
  mimeType: string | null;
  size?: number | null;
  read: () => Promise<Blob | ArrayBuffer>;
}

export interface ComposerPhoto {
  key: string;
  preview: string;
  /** Set once the upload is done. */
  path: string | null;
  failed: boolean;
}

let nextKey = 0;

export function useComposerPhotos({
  api,
  supabase,
  onError,
  onRelease,
}: {
  api: AssistantApi;
  supabase: SupabaseClient | null;
  onError: (message: string) => void;
  /** Frees a preview the platform made (web: a blob URL). */
  onRelease?: (preview: string) => void;
}) {
  const [photos, setPhotos] = useState<ComposerPhoto[]>([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const deps = useRef({ api, supabase, onError, onRelease });
  deps.current = { api, supabase, onError, onRelease };

  const update = (key: string, patch: Partial<ComposerPhoto>) =>
    setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const add = useCallback((picked: readonly PickedPhoto[]) => {
    const room = MAX_ASSISTANT_PHOTOS - photosRef.current.length;
    if (room <= 0) {
      deps.current.onError(`Up to ${MAX_ASSISTANT_PHOTOS} photos at a time.`);
      return;
    }
    if (picked.length > room) deps.current.onError(`Up to ${MAX_ASSISTANT_PHOTOS} photos at a time.`);
    for (const photo of picked.slice(0, room)) {
      const problem = assistantPhotoProblem({ type: photo.mimeType, size: photo.size });
      if (problem) {
        deps.current.onError(problem);
        deps.current.onRelease?.(photo.preview);
        continue;
      }
      const key = `photo-${++nextKey}`;
      const mimeType = assistantPhotoType(photo.mimeType)!;
      setPhotos((list) => [...list, { key, preview: photo.preview, path: null, failed: false }]);
      void (async () => {
        try {
          const { api: a, supabase: sb } = deps.current;
          if (!sb) throw new Error('Not signed in.');
          const [slot, body] = await Promise.all([a.photoSlot(mimeType), photo.read()]);
          const path = await uploadAssistantPhoto(sb, slot, body, mimeType);
          update(key, { path });
        } catch (err) {
          update(key, { failed: true });
          deps.current.onError(err instanceof Error ? err.message : 'Could not upload the photo.');
        }
      })();
    }
  }, []);

  const remove = useCallback((key: string) => {
    const gone = photosRef.current.find((p) => p.key === key);
    if (gone) deps.current.onRelease?.(gone.preview);
    setPhotos((list) => list.filter((p) => p.key !== key));
  }, []);

  /**
   * Empties the tray as the message goes out (previews stay alive for the
   * message on screen) and hands back what was in it, so a send that fails
   * can put it back with `restore`.
   */
  const take = useCallback(() => {
    const taken = photosRef.current;
    setPhotos([]);
    return taken;
  }, []);
  const restore = useCallback((taken: ComposerPhoto[]) => setPhotos(taken), []);

  // Previews left in the tray when the composer goes away are freed.
  useEffect(() => () => photosRef.current.forEach((p) => deps.current.onRelease?.(p.preview)), []);

  const uploading = photos.some((p) => !p.path && !p.failed);
  const outgoing: OutgoingPhoto[] = photos.flatMap((p) => (p.path ? [{ path: p.path, preview: p.preview }] : []));
  return { photos, add, remove, take, restore, uploading, outgoing, full: photos.length >= MAX_ASSISTANT_PHOTOS };
}

export type ComposerPhotos = ReturnType<typeof useComposerPhotos>;
