'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useDataCache } from '@/lib/data-cache';
import { OfflineHint } from '@/components/offline-hint';
import type { CostDocument, DocType } from '@homeup/core';
import { getEnabledModules, isFeatureEnabled } from '@homeup/core';
import { registerDocument, linkDocument, SIGNED_URL_TTL_SECONDS } from '@/lib/documents';
import { FileText, Upload, Trash2, Loader2, ExternalLink } from 'lucide-react';

// FLUX-106: map a legacy cost doc_type to a store DocType for the dual-write.
const COST_DOC_TYPE_TO_DOC_TYPE: Record<CostDocument['doc_type'], DocType> = {
  contract: 'contract',
  bill: 'invoice',
  receipt: 'receipt',
  other: 'other',
};

interface CostDocumentsProps {
  costItemId: string;
  groupId: string;
  onCountChange?: (count: number) => void;
}

const BUCKET = 'cost-documents';

const DOC_TYPE_LABEL: Record<string, string> = {
  contract: 'Contract',
  bill: 'Bill',
  receipt: 'Receipt',
  other: 'Doc',
};

export function CostDocuments({ costItemId, groupId, onCountChange }: CostDocumentsProps) {
  const { isOnline } = useDataCache();
  const [docs, setDocs] = useState<CostDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<CostDocument['doc_type']>('contract');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('cost_documents')
      .select('*')
      .eq('cost_item_id', costItemId)
      .order('created_at', { ascending: false });
    setDocs(data ?? []);
    setLoading(false);
    onCountChange?.(data?.length ?? 0);
  }, [costItemId, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpload = async (file: File) => {
    if (!isOnline) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const safeName = file.name.replace(/[^\w.\-]/g, '_');
      const path = `${groupId}/${costItemId}/${crypto.randomUUID()}-${safeName}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('cost_documents').insert({
        cost_item_id: costItemId,
        storage_path: path,
        filename: file.name,
        doc_type: docType,
        uploaded_by: user.id,
      });
      if (insErr) throw insErr;

      // FLUX-106 dual-write: also register the same object in the documents store
      // and link it to this cost item. Best-effort — a store failure must not
      // break the (already-succeeded) legacy upload.
      // Modules: writing into the documents store needs documents and costs (module-features.ts).
      if (isFeatureEnabled('documents.costs', getEnabledModules())) {
        try {
          const doc = await registerDocument({
            supabase,
            groupId,
            storagePath: path,
            filename: file.name,
            docType: COST_DOC_TYPE_TO_DOC_TYPE[docType],
            source: 'cost',
            mimeType: file.type || null,
            sizeBytes: file.size,
          });
          await linkDocument({
            supabase, documentId: doc.id, groupId,
            entityType: 'cost_item', entityId: costItemId, linkRole: docType,
          });
        } catch (storeErr) {
          console.error('documents store dual-write failed (legacy upload kept):', storeErr);
        }
      }

      await load();
    } catch (e) {
      console.error('Upload failed:', e);
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (doc: CostDocument) => {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      setError('Could not open document.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (doc: CostDocument) => {
    if (!confirm(`Delete "${doc.filename}"?`)) return;
    const supabase = createClient();
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    await supabase.from('cost_documents').delete().eq('id', doc.id);
    await load();
  };

  return (
    <div className="space-y-2">
      {/* Upload row */}
      <div className="flex items-center gap-2">
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as CostDocument['doc_type'])}
          className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground"
        >
          <option value="contract">Contract</option>
          <option value="bill">Bill</option>
          <option value="receipt">Receipt</option>
          <option value="other">Other</option>
        </select>
        <label
          className={
            isOnline
              ? "flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
              : "flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground opacity-60"
          }
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? 'Uploading…' : 'Upload file'}
          <input
            type="file"
            className="hidden"
            disabled={uploading || !isOnline}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
        </label>
        {!isOnline && <OfflineHint />}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents yet.</p>
      ) : (
        <div className="space-y-1">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5"
            >
              <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => handleView(doc)}
                className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-xs text-foreground hover:text-primary"
              >
                {doc.filename}
                <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
              </button>
              <span className="flex-shrink-0 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {DOC_TYPE_LABEL[doc.doc_type]}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(doc)}
                className="flex-shrink-0 text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                aria-label="Delete document"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
