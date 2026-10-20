'use client';

// FLUX-202: a small clickable image thumbnail for the (first) document linked
// to an entity — signs its own URL and opens the shared DocumentPreview on
// click. Used for the recipe source photo on both the scan review sheet and
// the recipe detail page, so both surfaces agree on the same look + behavior.
// Renders nothing when the entity has no linked document.

import { useEffect, useState } from 'react';
import { FileImage } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { listDocumentsForEntity, signedUrlForDocument } from '@/lib/documents';
import type { Document, DocumentEntityType } from '@homeup/core';
import { DocumentPreview } from './document-preview';

interface EntityPhotoThumbnailProps {
  entityType: DocumentEntityType;
  entityId: string;
  label?: string;
}

export function EntityPhotoThumbnail({ entityType, entityId, label = 'View photo' }: EntityPhotoThumbnailProps) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const docs = await listDocumentsForEntity(supabase, entityType, entityId);
      const d = docs[0] ?? null;
      if (cancelled) return;
      setDoc(d);
      if (d) {
        const signed = await signedUrlForDocument(supabase, d);
        if (!cancelled) setUrl(signed);
      }
    })();
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  if (!doc) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Source" className="h-10 w-10 rounded-md object-cover" />
        ) : (
          <FileImage className="h-5 w-5" />
        )}
        {label}
      </button>
      {previewOpen && (
        <DocumentPreview
          filename={doc.filename}
          storagePath={doc.storage_path}
          bucket="documents"
          label={doc.title}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}
