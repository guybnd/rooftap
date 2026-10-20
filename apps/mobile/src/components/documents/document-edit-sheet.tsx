// HOUP-83: native add-details / edit sheet for a stored document. Persists
// via documents$'s patchRow (offline-first, HOUP-73) + core's
// documentMetadataPatch — the same field-mapping web's edit modal uses — and
// keeps the expiry reminder in sync (syncDocumentReminder).
//
// HOUP-230: adopted the shared `ItemFormSheet` shell (preview header +
// Quick/Details split), same as every sibling sheet (tasks/setup/recipes/
// groceries/calendar) — this was the last hand-rolled BottomSheet. Linked
// costs are now editable here too (staged locally and diffed against
// `docLinks` on save, same one-model-commits-together shape as web's edit
// modal at apps/web/src/components/documents/document-edit-modal.tsx:88-105).
// A save error now surfaces inline instead of failing silently.
//
// The caller remounts this on `key={doc?.id ?? 'none'}` (same idiom as
// CostModal) so these initializers alone re-seed the form; no resync effect.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { X } from 'lucide-react-native';
import {
  Text,
  Button,
  DateScrollField,
  DetailsDisclosure,
  FieldRow,
  FormSection,
  Input,
  ItemFormSheet,
  SearchablePicker,
  TagInput,
} from '@homeup/ui';
import {
  CATEGORY_FIELDS,
  costItemsToOptions,
  documentMetadataPatch,
  documents$,
  DOC_TYPE_PICKER_OPTIONS,
  docTypeLabel,
  EXPIRY_CATEGORIES,
  linkDocument,
  syncDocumentReminder,
  unlinkDocument,
  useModules,
  useStoreHelpers,
  type CostItem,
  type Document,
  type DocType,
  type DocumentLink,
} from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { MetadataSubForm } from './metadata-subform';
import { sectionIconFor } from '@/lib/section-icons';

// Hearth v2 (E1): the sheet header wears the section's identity tile.
const DOCUMENTS_SECTION = { id: 'documents', Icon: sectionIconFor('documents') };

interface DocumentEditSheetProps {
  open: boolean;
  onClose: () => void;
  /** Store row only — legacy (non-store) documents never open this sheet. */
  doc: Document | null;
  docLinks: DocumentLink[];
  costItems: CostItem[];
  groupTags: string[];
  onSaved: () => void;
}

export function DocumentEditSheet({ open, onClose, doc, docLinks, costItems, groupTags, onSaved }: DocumentEditSheetProps) {
  const { patchRow } = useStoreHelpers(documents$(doc?.group_id ?? null), null);
  // Modules: linking a document to bills needs documents and costs (module-features.ts).
  const costLinksOn = useModules().feature('documents.costs');

  const [name, setName] = React.useState(doc?.title ?? doc?.filename ?? '');
  const [docType, setDocType] = React.useState<DocType>(doc?.doc_type ?? 'other');
  const [expiry, setExpiry] = React.useState(doc?.expiry_date ?? '');
  const [tags, setTags] = React.useState<string[]>(doc?.tags ?? []);
  const [metadata, setMetadata] = React.useState<Record<string, unknown>>(doc?.metadata ?? {});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Cost links are staged locally and flushed on Save, so the whole sheet
  // commits with one model — Cancel discards link edits like every other
  // field (mirrors web's document-edit-modal.tsx).
  const [linkedCostIds, setLinkedCostIds] = React.useState<string[]>(
    () => docLinks.filter((l) => l.entity_type === 'cost_item').map((l) => l.entity_id)
  );
  const linkableCostItems = costItems.filter((c) => !linkedCostIds.includes(c.id));

  const canSave = name.trim().length > 0;

  const save = async () => {
    if (!doc || busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const patch = documentMetadataPatch({ title: name, docType, tags, expiryDate: expiry || null, metadata });
      if (Object.keys(patch).length > 0) patchRow(doc.id, patch);

      // Diff staged links against the originals and apply the delta (none
      // while Costs is off: the field isn't there to stage any).
      const supabase = getCurrentSupabaseClient();
      const originalIds = new Set(
        docLinks.filter((l) => l.entity_type === 'cost_item').map((l) => l.entity_id)
      );
      const current = new Set(linkedCostIds);
      const toAdd = costLinksOn ? linkedCostIds.filter((id) => !originalIds.has(id)) : [];
      const toRemove = costLinksOn
        ? docLinks.filter((l) => l.entity_type === 'cost_item' && !current.has(l.entity_id))
        : [];
      for (const id of toAdd) {
        await linkDocument({ supabase, documentId: doc.id, groupId: doc.group_id, entityType: 'cost_item', entityId: id });
      }
      for (const link of toRemove) {
        await unlinkDocument(supabase, link);
      }

      await syncDocumentReminder(supabase, {
        id: doc.id,
        groupId: doc.group_id,
        name: name.trim() || doc.filename,
        expiryDate: expiry || null,
      });
      onSaved();
      onClose();
    } catch {
      setError('Could not save changes. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const hasMetadataFields = !!CATEGORY_FIELDS[docType];
  const detailsCount = (hasMetadataFields ? 1 : 0) + 1 /* tags */ + (costLinksOn ? 1 : 0) /* linked costs */;

  return (
    <ItemFormSheet
      section={DOCUMENTS_SECTION}
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title="Edit document"
      previewContent={
        // E1: the section tile already leads, so no second glyph; the title
        // and one caption of facts (the type). Mirrors web.
        <>
          <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-medium text-foreground">
            {name || doc?.filename}
          </Text>
          <Text className="shrink-0 text-caption text-muted-foreground">{docTypeLabel(docType)}</Text>
        </>
      }
      onSubmit={() => void save()}
      canSubmit={canSave}
      saving={busy}
    >
      <FormSection>
        <FieldRow label="Name">
          <Input value={name} onChangeText={setName} placeholder="Document name" autoFocus />
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
          action={
            <View className="flex-row items-center gap-2">
              {EXPIRY_CATEGORIES.has(docType) ? (
                // A hint, not a state: no warning hue (H2).
                <Text className="text-xs text-muted-foreground">Recommended</Text>
              ) : (
                <Text className="text-xs text-muted-foreground">Optional</Text>
              )}
              {expiry !== '' && (
                <Button size="xs" variant="ghost" onPress={() => setExpiry('')}>
                  Clear
                </Button>
              )}
            </View>
          }
        >
          <DateScrollField value={expiry} onChange={setExpiry} />
        </FieldRow>
      </FormSection>

      <DetailsDisclosure count={detailsCount}>
        <FormSection>
          {hasMetadataFields && <MetadataSubForm docType={docType} value={metadata} onChange={setMetadata} />}

          <FieldRow label="Tags">
            <TagInput tags={tags} onChange={setTags} suggestions={groupTags} />
          </FieldRow>

          {costLinksOn && (
            <FieldRow label="Linked costs">
              <View className="flex-row flex-wrap items-center gap-1.5">
                {linkedCostIds.map((id) => {
                  const costName = costItems.find((c) => c.id === id)?.name ?? 'Cost item';
                  return (
                    // Neutral: the chip is a value in this form, and only its
                    // remove button is a control (H2).
                    <View key={id} className="flex-row items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-2">
                      <Text className="text-xs font-medium text-foreground">{costName}</Text>
                      <Pressable
                        onPress={() => setLinkedCostIds((prev) => prev.filter((x) => x !== id))}
                        accessibilityRole="button"
                        accessibilityLabel={`Unlink ${costName}`}
                        hitSlop={8}
                      >
                        <X size={14} className="text-muted-foreground" />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
              {linkableCostItems.length > 0 && (
                <View className="mt-1.5">
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
                </View>
              )}
            </FieldRow>
          )}
        </FormSection>
      </DetailsDisclosure>

      {error && <Text className="text-xs text-destructive">{error}</Text>}
    </ItemFormSheet>
  );
}
