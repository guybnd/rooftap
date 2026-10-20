'use client';

// FLUX-122: in-app popup for viewing a document — images inline, PDFs in an
// iframe — instead of opening a new browser tab. Generalised from the warranty
// file preview (FLUX-83); signs its own URL from a storage path + bucket so any
// surface (documents page, linked-documents panel) can reuse it. Retains an
// "open in new tab" affordance and closes on backdrop click or Escape.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import { signedDocumentUrl, SIGNED_URL_TTL_SECONDS } from '@/lib/documents';
import { X, ExternalLink, Loader2, FileText } from 'lucide-react';

interface DocumentPreviewProps {
  filename: string;
  storagePath: string;
  bucket: string;
  label?: string | null;
  onClose: () => void;
}

export function DocumentPreview({ filename, storagePath, bucket, label, onClose }: DocumentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const isImage = /\.(jpe?g|png|webp|gif)$/i.test(filename);
  const isPdf = /\.pdf$/i.test(filename);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const signed = await signedDocumentUrl(supabase, storagePath, SIGNED_URL_TTL_SECONDS, bucket);
      if (cancelled) return;
      if (signed) setUrl(signed);
      else setError(true);
    })();
    return () => { cancelled = true; };
  }, [storagePath, bucket]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portalled to the body: rendered in place (inside a list row), the route
  // region's own stacking context kept it under the phone tab bar and FAB.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border py-1.5 pl-4 pr-1.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{label || filename}</span>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Open in new tab"
              aria-label="Open in new tab"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/20">
          {error ? (
            <p className="p-10 text-sm text-muted-foreground">Could not load this file.</p>
          ) : !url ? (
            <div className="p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={filename} className="max-h-[80vh] w-auto object-contain" />
          ) : isPdf ? (
            <iframe src={url} title={filename} className="h-[80vh] w-full" />
          ) : (
            <div className="p-10 text-center">
              <p className="mb-3 text-sm text-muted-foreground">Preview isn&apos;t available for this file type.</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <ExternalLink className="h-4 w-4" /> Open file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
