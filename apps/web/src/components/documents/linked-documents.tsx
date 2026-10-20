'use client';

// FLUX-105: renders the documents linked to one service (cost item, warranty
// asset, grocery session…) FROM the central store. Sits alongside any legacy
// per-table file list (e.g. cost-documents) — during v1 both coexist, so nothing
// disappears. Open via signed URL (bucket resolved from source) + unlink.

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  listDocumentsForEntity,
  listCostDocumentPaths,
  signedUrlForDocument,
  unlinkDocument,
  docTypeLabel,
} from '@/lib/documents';
import type { Document, DocumentEntityType } from '@homeup/core';
import { FileText, ExternalLink, Link2Off, Loader2 } from 'lucide-react';
import {
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
} from '@/components/ui/list-item';

interface LinkedDocumentsProps {
  entityType: DocumentEntityType;
  entityId: string;
  onCountChange?: (count: number) => void;
}

export function LinkedDocuments({ entityType, entityId, onCountChange }: LinkedDocumentsProps) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    let d = await listDocumentsForEntity(supabase, entityType, entityId);
    // FLUX-106: the legacy cost_documents list (rendered alongside this panel on
    // the cost card) already shows files that were dual-written into the store.
    // Exclude those here so each file appears once — leaving only store-exclusive
    // docs (e.g. captured invoices not in cost_documents).
    if (entityType === 'cost_item') {
      const legacyPaths = new Set(await listCostDocumentPaths(supabase, entityId));
      d = d.filter((doc) => !legacyPaths.has(doc.storage_path));
    }
    setDocs(d);
    setLoading(false);
    onCountChange?.(d.length);
  }, [entityType, entityId, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (doc: Document) => {
    const supabase = createClient();
    const url = await signedUrlForDocument(supabase, doc);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const unlink = async (doc: Document) => {
    const supabase = createClient();
    await unlinkDocument(supabase, { document_id: doc.id, entity_type: entityType, entity_id: entityId });
    await load();
  };

  // Render nothing when empty — the legacy panel already owns the empty state.
  if (loading) {
    return (
      <div className="flex justify-center py-1.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (docs.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">From document store</p>
      {/* H4: nested inside the cost-card's own bordered panel already, so this
          sub-list gets hairline dividers only, never a second border/shadow. */}
      <div className="divide-y divide-border/60 rounded-lg bg-muted/10">
      {docs.map((doc) => (
        <ListItem key={doc.id} className="gap-2 py-1.5 px-2">
          <ListItemLeading>
            <FileText className="h-4 w-4" />
          </ListItemLeading>
          <ListItemContent className="gap-0">
            <button onClick={() => open(doc)} className="min-w-0 text-left">
              <ListItemTitle className="text-xs hover:text-primary">
                {doc.title || doc.filename}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
              </ListItemTitle>
            </button>
          </ListItemContent>
          <ListItemTrailing className="gap-2">
            <ListItemMeta className="text-[10px] uppercase">{docTypeLabel(doc.doc_type)}</ListItemMeta>
            <button
              onClick={() => unlink(doc)}
              className="shrink-0 hover:text-destructive"
              aria-label="Unlink document"
              title="Unlink from this item"
            >
              <Link2Off className="h-3.5 w-3.5" />
            </button>
          </ListItemTrailing>
        </ListItem>
      ))}
      </div>
    </div>
  );
}
