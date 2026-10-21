// HOUP-218: native cost-documents composite — the entity-scoped Documents
// portal rendered inside a CostRow's expandable "docs" panel. Reuses the same
// native pieces + core documents layer as apps/mobile/src/app/(tabs)/documents/index.tsx
// (DocumentRow, CaptureFlow, DocumentPreview, DocumentEditSheet,
// @homeup/core's documents$ store + documents.ts fns) scoped to
// entity_type:'cost_item' via document_links instead of the group-wide list.
// No legacy cost_documents dual-write (web's CostDocuments): every mobile
// capture already lands in the unified store, so there's nothing to dedupe
// against — this is the store-only half of web's cost-card.tsx (CostDocuments
// + LinkedDocuments combined into one source).
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { Paperclip } from 'lucide-react-native';
import { Text, Button } from '@homeup/ui';
import {
  deleteDocument,
  documentBucket,
  documents$,
  getEnabledModules,
  isFeatureEnabled,
  linkDocument,
  listCostItems,
  listDocumentTags,
  listLinksForGroup,
  useReconnectSync,
  useStoreLoaded,
  type CostItem,
  type Document,
  type DocumentLink,
  type UnifiedDocument,
  dialog,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { useGroupTableRefetch } from '@/lib/use-group-table-realtime';
import { DocumentRow } from '@/components/documents/document-row';
import { CaptureFlow } from '@/components/documents/capture-flow';
import { DocumentEditSheet } from '@/components/documents/document-edit-sheet';
import { DocumentPreview, isPdfFilename, openDocumentExternally } from '@/components/documents/document-preview';

function toUnified(d: Document): UnifiedDocument {
  return {
    key: `store:${d.id}`,
    storeId: d.id,
    title: d.title,
    filename: d.filename,
    docType: d.doc_type,
    source: d.source,
    createdAt: d.created_at,
    storagePath: d.storage_path,
    bucket: documentBucket(d.source),
    folderId: d.folder_id ?? null,
    legacy: false,
    groupId: d.group_id,
    expiryDate: d.expiry_date,
    tags: d.tags ?? [],
    metadata: d.metadata ?? {},
    uploadedBy: d.uploaded_by,
  };
}

interface CostDocumentsProps {
  costItemId: string;
  groupId: string;
  onCountChange?: (count: number) => void;
}

export function CostDocuments({ costItemId, groupId, onCountChange }: CostDocumentsProps) {
  const { memberProfiles } = useDataCache();

  useReconnectSync(documents$(groupId));
  const storeLoaded = useStoreLoaded(documents$(groupId));
  const storeDocs = use$(() =>
    Object.values(documents$(groupId).get() ?? {}).filter((d): d is Document => !!d && !d.deleted)
  );

  const [allLinks, setAllLinks] = React.useState<DocumentLink[]>([]);
  const [linksLoaded, setLinksLoaded] = React.useState(false);
  const [costItems, setCostItems] = React.useState<CostItem[]>([]);
  const [groupTags, setGroupTags] = React.useState<string[]>([]);

  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [editingDoc, setEditingDoc] = React.useState<Document | null>(null);
  const [previewingDoc, setPreviewingDoc] = React.useState<UnifiedDocument | null>(null);

  const loadLinks = React.useCallback(async () => {
    const links = await listLinksForGroup(getCurrentSupabaseClient(), groupId);
    setAllLinks(links);
    setLinksLoaded(true);
  }, [groupId]);

  React.useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  useGroupTableRefetch({ table: 'document_links', groupId, refetch: () => void loadLinks() });

  // Only fetched once this panel is expanded (it only mounts then) — cheap,
  // and DocumentEditSheet's "Linked costs" field + DocumentRow's cost-link
  // chips both need the full cost list to resolve names.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getCurrentSupabaseClient();
      const [items, tags] = await Promise.all([listCostItems(supabase, groupId), listDocumentTags(supabase, groupId)]);
      if (!cancelled) {
        setCostItems(items);
        setGroupTags(tags);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const costNames = React.useMemo(() => Object.fromEntries(costItems.map((c) => [c.id, c.name])), [costItems]);

  const linksByDoc = React.useMemo(() => {
    const m = new Map<string, DocumentLink[]>();
    for (const l of allLinks) {
      const arr = m.get(l.document_id) ?? [];
      arr.push(l);
      m.set(l.document_id, arr);
    }
    return m;
  }, [allLinks]);

  const linkedIds = React.useMemo(
    () => new Set(allLinks.filter((l) => l.entity_type === 'cost_item' && l.entity_id === costItemId).map((l) => l.document_id)),
    [allLinks, costItemId]
  );

  const docs = React.useMemo(
    () => storeDocs.filter((d) => linkedIds.has(d.id)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [storeDocs, linkedIds]
  );

  React.useEffect(() => {
    if (linksLoaded) onCountChange?.(docs.length);
  }, [docs.length, linksLoaded, onCountChange]);

  const preview = async (doc: UnifiedDocument) => {
    if (isPdfFilename(doc.filename)) {
      await openDocumentExternally(getCurrentSupabaseClient(), doc.storagePath, doc.bucket);
    } else {
      setPreviewingDoc(doc);
    }
  };

  const openEdit = (doc: UnifiedDocument) => {
    const row = storeDocs.find((d) => d.id === doc.storeId);
    if (row) setEditingDoc(row);
  };

  const remove = (doc: UnifiedDocument) => {
    if (!doc.storeId) return;
    dialog.alert(`Delete "${doc.title || doc.filename}"?`, 'This removes it from the document store.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const row = storeDocs.find((d) => d.id === doc.storeId);
          if (!row) return;
          await deleteDocument(getCurrentSupabaseClient(), row);
        },
      },
    ]);
  };

  if (!linksLoaded) {
    return (
      <View className="items-center py-3">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="gap-2">
      <Button variant="outline" size="sm" className="self-start" onPress={() => setCaptureOpen(true)}>
        <Paperclip size={13} className="text-foreground" />
        <Text className="text-sm font-medium text-foreground">Attach a file</Text>
      </Button>

      {docs.length === 0 ? (
        <Text className="text-center text-caption text-muted-foreground">No documents yet.</Text>
      ) : (
        <View className="gap-1.5">
          {docs.map((d) => (
            <DocumentRow
              key={d.id}
              doc={toUnified(d)}
              costLinks={linksByDoc.get(d.id) ?? []}
              costNames={costNames}
              memberProfiles={memberProfiles}
              reminderTaskId={null}
              onPreview={preview}
              onEdit={openEdit}
              onDelete={remove}
              onDeleteLegacy={() => {}}
              onSetReminder={() => {}}
              onShare={() => {}}
              onToggleTag={() => {}}
              // Filing is a Documents-section concern; this list is scoped to
              // one cost item, where a folder move would have no visible effect.
              onMoveToFolder={null}
              onOpenReminder={() => {}}
              onOpenLink={() => {}}
            />
          ))}
        </View>
      )}

      {!storeLoaded && docs.length === 0 && (
        <View className="items-center py-1">
          <ActivityIndicator size="small" />
        </View>
      )}

      <CaptureFlow
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        groupId={groupId}
        groupTags={groupTags}
        onUploaded={(doc) => {
          // Modules: linking a document to this bill needs documents and costs (module-features.ts).
          if (!isFeatureEnabled('documents.costs', getEnabledModules())) return;
          void linkDocument({
            supabase: getCurrentSupabaseClient(),
            documentId: doc.id,
            groupId,
            entityType: 'cost_item',
            entityId: costItemId,
          }).then(() => void loadLinks());
        }}
      />

      <DocumentEditSheet
        key={editingDoc?.id ?? 'none'}
        open={!!editingDoc}
        onClose={() => setEditingDoc(null)}
        doc={editingDoc}
        docLinks={editingDoc ? linksByDoc.get(editingDoc.id) ?? [] : []}
        costItems={costItems}
        groupTags={groupTags}
        onSaved={() => void loadLinks()}
      />

      {previewingDoc && (
        <DocumentPreview
          open={!!previewingDoc}
          onClose={() => setPreviewingDoc(null)}
          supabase={getCurrentSupabaseClient()}
          filename={previewingDoc.filename}
          storagePath={previewingDoc.storagePath}
          bucket={previewingDoc.bucket}
          label={previewingDoc.title}
        />
      )}
    </View>
  );
}
