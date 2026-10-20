'use client';

// FLUX-121: edit a stored document's full metadata (name, category, expiry,
// tags) — the post-upload counterpart to the FLUX-114 capture details step.
// FLUX-150: persists via the `documents$` Legend store's patchRow instead of
// a direct Supabase update, so edits apply offline and sync on reconnect.
// Store rows only; legacy files are open-only and never reach this modal.
// FLUX-234: migrated off the plain Dialog onto the shared ItemFormSheet
// (Quick/Details split), opened from the row's hold-to-actions sheet.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  documentMetadataPatch,
  listDocumentTags,
  linkDocument,
  unlinkDocument,
  DOC_TYPE_PICKER_OPTIONS,
  docTypeLabel,
  type UnifiedDocument,
} from '@/lib/documents';
import { costItemsToOptions, documents$, useModules, useStoreHelpers } from '@homeup/core';
import { syncDocumentReminder } from '@homeup/core';
import { CATEGORY_FIELDS } from '@homeup/core';
import type { CostItem, DocType, DocumentLink } from '@homeup/core';
import { ItemFormSheet, FormSection, FieldRow, DetailsDisclosure } from '@/components/ui/item-form-sheet';
import { SearchablePicker } from '@/components/ui/searchable-picker';
import { TagInput } from '@/components/ui/tag-input';
import { MetadataSubForm } from '@/components/documents/metadata-subform';
import { X } from 'lucide-react';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const DOCUMENTS_SECTION = { id: 'documents', Icon: sectionIconFor('documents') };

/** Open the native date picker on click — the indicator alone is unreliable in dark mode. */
function openDatePicker(e: React.MouseEvent<HTMLInputElement>) {
  try { e.currentTarget.showPicker?.(); } catch { /* not supported — fall back to the indicator */ }
}

const EXPIRY_CATEGORIES = new Set<DocType>([
  'warranty', 'id_personal', 'insurance', 'vehicle', 'lease_contract',
]);

interface DocumentEditModalProps {
  doc: UnifiedDocument;
  docLinks: DocumentLink[];
  costItems: CostItem[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function DocumentEditModal({ doc, docLinks, costItems, onClose, onSaved }: DocumentEditModalProps) {
  // patchRow doesn't reference currentUserId (only writeRow's INSERT path does).
  const { patchRow } = useStoreHelpers(documents$(doc.groupId), null);
  // Modules: linking a document to bills needs documents and costs (module-features.ts).
  const costLinksOn = useModules().feature('documents.costs');

  const [name, setName] = useState(doc.title ?? doc.filename);
  const [docType, setDocType] = useState<DocType>((doc.docType as DocType) ?? 'other');
  const [expiry, setExpiry] = useState(doc.expiryDate ?? '');
  const [tags, setTags] = useState<string[]>(doc.tags ?? []);
  const [metadata, setMetadata] = useState<Record<string, unknown>>(doc.metadata ?? {});
  const [groupTags, setGroupTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cost links are staged locally and flushed on Save, so the whole dialog
  // commits with one model — Cancel discards link edits like every other field
  // (FLUX-123).
  const [linkedCostIds, setLinkedCostIds] = useState<string[]>(
    () => docLinks.filter((l) => l.entity_type === 'cost_item').map((l) => l.entity_id)
  );
  const linkableCostItems = costItems.filter((c) => !linkedCostIds.includes(c.id));

  useEffect(() => {
    const supabase = createClient();
    listDocumentTags(supabase, doc.groupId).then(setGroupTags).catch(() => {});
  }, [doc.groupId]);

  const save = async () => {
    if (!doc.storeId) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const patch = documentMetadataPatch({
        title: name,
        docType,
        tags,
        expiryDate: expiry || null,
        metadata,
      });
      if (Object.keys(patch).length > 0) patchRow(doc.storeId, patch);
      // Diff staged links against the originals and apply the delta (none
      // while Costs is off: the field isn't there to stage any).
      const originalIds = new Set(
        docLinks.filter((l) => l.entity_type === 'cost_item').map((l) => l.entity_id)
      );
      const current = new Set(linkedCostIds);
      const toAdd = costLinksOn ? linkedCostIds.filter((id) => !originalIds.has(id)) : [];
      const toRemove = costLinksOn
        ? docLinks.filter((l) => l.entity_type === 'cost_item' && !current.has(l.entity_id))
        : [];
      for (const id of toAdd) {
        await linkDocument({
          supabase, documentId: doc.storeId, groupId: doc.groupId,
          entityType: 'cost_item', entityId: id,
        });
      }
      for (const link of toRemove) {
        await unlinkDocument(supabase, link);
      }
      // Keep the expiry reminder in sync with the edited date/name (FLUX-116).
      await syncDocumentReminder(supabase, {
        id: doc.storeId, groupId: doc.groupId, name: name.trim() || doc.filename, expiryDate: expiry || null,
      });
      await onSaved();
      onClose();
    } catch {
      setError('Could not save changes. Please try again.');
      setBusy(false);
    }
  };

  const hasMetadataFields = !!CATEGORY_FIELDS[docType];
  const showLinkedCosts = !!doc.storeId && costLinksOn;
  const detailsCount = (hasMetadataFields ? 1 : 0) + 1 /* tags */ + (showLinkedCosts ? 1 : 0) /* linked costs */;

  return (
    <ItemFormSheet
      section={DOCUMENTS_SECTION}
      isOpen
      onClose={onClose}
      title="Edit document"
      previewContent={
        // E1: the section tile already leads, so no second glyph; the
        // title and one caption of facts (the type).
        <>
          <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-foreground">
            {name || doc.filename}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{docTypeLabel(docType)}</span>
        </>
      }
      onSubmit={() => void save()}
      saving={busy}
    >
      <FormSection>
        <FieldRow label="Name" htmlFor="doc-edit-name">
          <input
            id="doc-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </FieldRow>

        <FieldRow label="Category">
          <SearchablePicker
            options={DOC_TYPE_PICKER_OPTIONS}
            value={docType}
            onChange={(v) => setDocType(v as DocType)}
            placeholder="Choose a category…"
            searchPlaceholder="Search categories…"
            ariaLabel="Document category"
          />
        </FieldRow>

        <FieldRow
          label="Expiry date"
          htmlFor="doc-edit-expiry"
          action={
            EXPIRY_CATEGORIES.has(docType)
              // A hint, not a state: no warning hue (H2).
              ? <span className="text-xs text-muted-foreground">Recommended</span>
              : <span className="text-xs text-muted-foreground">Optional</span>
          }
        >
          <input
            id="doc-edit-expiry"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            onClick={openDatePicker}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </FieldRow>
      </FormSection>

      <DetailsDisclosure count={detailsCount}>
        <FormSection>
          {/* Per-category sub-fields (FLUX-133) */}
          {hasMetadataFields && (
            <MetadataSubForm docType={docType} value={metadata} onChange={setMetadata} />
          )}

          <FieldRow label="Tags">
            <TagInput tags={tags} onChange={setTags} suggestions={groupTags} />
          </FieldRow>

          {/* Linked costs (#1) — store rows only */}
          {showLinkedCosts && (
            <FieldRow label="Linked costs">
              <div className="flex flex-wrap items-center gap-1.5">
                {linkedCostIds.map((id) => {
                  const costName = costItems.find((c) => c.id === id)?.name ?? 'Cost item';
                  return (
                    // Neutral: the chip is a value in this form, and only its
                    // remove button is a control (H2).
                    <span key={id} className="inline-flex items-center gap-0.5 rounded-full bg-muted py-1 pl-2.5 pr-1 text-xs font-medium text-foreground">
                      {costName}
                      <button type="button" onClick={() => setLinkedCostIds((prev) => prev.filter((x) => x !== id))} aria-label={`Unlink ${costName}`} className="-my-1 rounded-full p-1 text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
              {linkableCostItems.length > 0 && (
                <div className="mt-1.5">
                  <SearchablePicker
                    options={costItemsToOptions(linkableCostItems)}
                    value={null}
                    onChange={(id) => setLinkedCostIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
                    placeholder="Link a cost…"
                    searchPlaceholder="Search cost items…"
                    emptyText="No cost items"
                    recentCount={3}
                    ariaLabel="Link a cost item"
                  />
                </div>
              )}
            </FieldRow>
          )}
        </FormSection>
      </DetailsDisclosure>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </ItemFormSheet>
  );
}
