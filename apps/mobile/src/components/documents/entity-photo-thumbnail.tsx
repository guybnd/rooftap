// HOUP-153: native port of apps/web/src/components/documents/entity-photo-thumbnail.tsx.
// A small clickable image thumbnail for the (first) document linked to an
// entity — signs its own URL and opens the shared DocumentPreview sheet on
// tap. Used for the recipe source photo on the mobile draft-review sheet.
// Renders nothing when the entity has no linked document. Rendered as a
// PortalChip (Hearth PC5 "neutral" — opens in place, an attachment) rather
// than a bare pressable, matching the row-portal contract.
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { ImageIcon } from 'lucide-react-native';
import { PortalChip } from '@homeup/ui';
import { listDocumentsForEntity, signedUrlForDocument, type Document, type DocumentEntityType } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
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
    const supabase = getCurrentSupabaseClient();
    (async () => {
      const docs = await listDocumentsForEntity(supabase, entityType, entityId);
      const d = docs[0] ?? null;
      if (cancelled) return;
      setDoc(d);
      if (d) {
        const signed = await signedUrlForDocument(supabase, d);
        if (!cancelled) setUrl(signed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  if (!doc) return null;

  return (
    <>
      <PortalChip
        icon={
          url ? (
            <Image source={{ uri: url }} style={{ width: 24, height: 24, borderRadius: 4 }} contentFit="cover" />
          ) : (
            <ImageIcon size={14} className="text-muted-foreground" />
          )
        }
        label={label}
        tone="neutral"
        onOpen={() => setPreviewOpen(true)}
      />
      <DocumentPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        supabase={getCurrentSupabaseClient()}
        filename={doc.filename}
        storagePath={doc.storage_path}
        bucket="documents"
        label={doc.title}
      />
    </>
  );
}
