// FLUX-98 / FLUX-103 / HOUP-83: the central documents store — moved here from
// apps/web/src/lib/documents.ts (HOUP-83) so both apps/web and apps/mobile
// share one implementation. All capture/intake flows upload through
// `uploadDocument`, then attach the row to any number of services via
// `linkDocument` (polymorphic many-to-many). Files live in the private
// `documents` bucket (hosted: Cloudflare R2 first, see document-storage.ts);
// the bucket enforces a 50 MB cap and image/pdf only server-side. These helpers add the same checks client-side for fast
// feedback and wrap upload/link/list/sign/delete.
//
// Land here first for anything touching document storage. Additive — it does
// not replace the legacy cost_documents / warranty_files / grocery receipt
// silos (FLUX-106 unifies via `listUnifiedDocuments`).
//
// HOUP-83: `uploadDocument`/`registerDocument` take a platform-neutral
// `DocumentUploadInput` instead of a browser `File` — web builds one from a
// `File` in its thin facade (apps/web/src/lib/documents.ts); native builds
// one from an expo-image-picker/expo-document-picker asset.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Document,
  DocumentEntityType,
  DocumentLink,
  DocumentSource,
  DocType,
  PickerOption,
} from '../../types';
import { syncState, type Observable } from '@legendapp/state';
import { documents$ } from '../../data/stores';
import { envRandomUUID } from '../../data/store-environment';
import type { ModuleFeatureId } from '../../module-features';
import { getDocumentStorage, requestDocumentStorage } from './document-storage';
import { DOCUMENT_FILE_LIMITS } from '../../entitlements';

// Canonical label + chip colour for each document category. Single source of
// truth for the capture flow (FLUX-114) and the documents explorer (FLUX-118);
// mirrors the CATEGORY_META pattern in costs.ts. Includes the legacy 'bill'
// doc_type that appears on unified legacy cost_documents rows.
export const DOC_TYPE_META: Record<string, { label: string; color: string }> = {
  invoice: { label: 'Invoice', color: 'bg-blue-900/40 text-blue-300' },
  receipt: { label: 'Receipt', color: 'bg-cyan-900/40 text-cyan-300' },
  warranty: { label: 'Warranty', color: 'bg-emerald-900/40 text-emerald-300' },
  manual: { label: 'Manual', color: 'bg-teal-900/40 text-teal-300' },
  contract: { label: 'Contract', color: 'bg-indigo-900/40 text-indigo-300' },
  photo: { label: 'Photo', color: 'bg-fuchsia-900/40 text-fuchsia-300' },
  id_personal: { label: 'ID / Personal', color: 'bg-rose-900/40 text-rose-300' },
  insurance: { label: 'Insurance', color: 'bg-green-900/40 text-green-300' },
  lease_contract: { label: 'Lease / Contract', color: 'bg-violet-900/40 text-violet-300' },
  tax_financial: { label: 'Tax / Financial', color: 'bg-amber-900/40 text-amber-300' },
  medical: { label: 'Medical', color: 'bg-pink-900/40 text-pink-300' },
  vehicle: { label: 'Vehicle', color: 'bg-orange-900/40 text-orange-300' },
  appliance_manual: { label: 'Appliance manual', color: 'bg-lime-900/40 text-lime-300' },
  bill: { label: 'Bill', color: 'bg-slate-700 text-slate-300' },
  other: { label: 'Other', color: 'bg-slate-700 text-slate-300' },
};

/** Human label for a document category, falling back to the raw value. */
export function docTypeLabel(docType: string): string {
  return DOC_TYPE_META[docType]?.label ?? docType;
}

/** doc_type options for category pickers — all categories except the legacy 'bill'. */
export const DOC_TYPE_PICKER_OPTIONS: PickerOption[] = Object.keys(DOC_TYPE_META)
  .filter((k) => k !== 'bill')
  .map((k) => ({ value: k, primary: DOC_TYPE_META[k].label, group: null }));

/** Categories where an expiry date is worth prompting for (capture + edit). */
export const EXPIRY_CATEGORIES = new Set<DocType>([
  'warranty', 'id_personal', 'insurance', 'vehicle', 'lease_contract',
]);

/** Default name: "<Category> – <date>[ – <OCR title>]". */
export function defaultDocName(docType: DocType, ocrTitle?: string | null): string {
  const datePart = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const base = `${docTypeLabel(docType)} – ${datePart}`;
  return ocrTitle ? `${base} – ${ocrTitle}` : base;
}

export const DOCUMENTS_BUCKET = 'documents';

// The largest document any household may upload (a comped household on R2,
// .docs/r2-storage.md). Clients only pre-check against this; the /api/storage
// route enforces each household's own cap (entitlements.ts).
export const DOCUMENT_MAX_BYTES = DOCUMENT_FILE_LIMITS.exempt.bytes;
/** The standard (Free) cap as users read it, for upload hints. */
export const DOCUMENT_MAX_LABEL = DOCUMENT_FILE_LIMITS.free.label;
// Supabase Storage's cap: the documents bucket's file_size_limit, and the most
// a Supabase Free project allows per file. Applies when a file falls back to
// Supabase (self-host, or R2 unreachable); keep it in step with the bucket.
export const SUPABASE_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export const SUPABASE_DOCUMENT_MAX_LABEL = '50 MB';
export const DOCUMENT_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * Platform-neutral upload payload. Web passes the in-memory `body`; native
 * may pass a local file `uri` instead, which is streamed to R2 from disk and
 * only read into memory if the file falls back to Supabase Storage.
 */
export interface DocumentUploadInput {
  body?: Blob | ArrayBuffer | FormData;
  uri?: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}

/** Returns an error message if the file metadata is invalid, or null if it passes. */
export function validateDocumentMeta({
  mimeType,
  sizeBytes,
}: {
  mimeType: string | null;
  sizeBytes: number;
}): string | null {
  if (!mimeType || !(DOCUMENT_ACCEPTED_TYPES as readonly string[]).includes(mimeType)) {
    return 'Only images (JPG, PNG, WebP) or PDF files are allowed.';
  }
  if (sizeBytes > DOCUMENT_MAX_BYTES) {
    return `File is too large (max ${DOCUMENT_FILE_LIMITS.exempt.label}).`;
  }
  return null;
}

export interface UploadDocumentArgs {
  supabase: SupabaseClient;
  groupId: string;
  input: DocumentUploadInput;
  docType: DocType;
  source: DocumentSource;
  title?: string;
  parsed?: unknown;
  expiryDate?: string | null;  // FLUX-113: YYYY-MM-DD
  tags?: string[];             // FLUX-113: free-text filing tags
  metadata?: Record<string, unknown>;  // FLUX-133: per-category sub-fields
  /** Filing folder (document_folders); left out = root. */
  folderId?: string | null;
}

/** Normalise a tag list: trim, lowercase, drop blanks, de-dupe. */
export function normalizeTags(tags?: string[] | null): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    const tag = t.trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/**
 * Validate, upload to the documents bucket, and record a `documents` row.
 * Throws with a user-presentable message on validation/upload failure.
 */
export async function uploadDocument({
  supabase,
  groupId,
  input,
  docType,
  source,
  title,
  parsed,
  expiryDate,
  tags,
  metadata,
  folderId,
}: UploadDocumentArgs): Promise<Document> {
  const validationError = validateDocumentMeta({ mimeType: input.mimeType, sizeBytes: input.sizeBytes });
  if (validationError) throw new Error(validationError);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Pre-generate the row id so the storage path and the metadata row agree.
  const documentId = envRandomUUID();
  const safeName = input.filename.replace(/[^\w.\-]/g, '_');
  const path = `${groupId}/${documentId}/${envRandomUUID()}-${safeName}`;

  const storedInR2 = await uploadToR2(path, input);
  if (!storedInR2) {
    if (input.sizeBytes > SUPABASE_DOCUMENT_MAX_BYTES) {
      throw new Error(`File is too large (max ${SUPABASE_DOCUMENT_MAX_LABEL}).`);
    }
    const env = getDocumentStorage();
    const body = input.body ?? (input.uri && env?.readFile ? await env.readFile(input.uri) : undefined);
    if (!body) throw new Error('Could not read the file. Please try again.');
    const { error: upErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, body, { contentType: input.mimeType ?? undefined });
    if (upErr) throw new Error('Upload failed. Please try again.');
  }

  const { data, error: insErr } = await supabase
    .from('documents')
    .insert({
      id: documentId,
      group_id: groupId,
      storage_path: path,
      filename: input.filename,
      mime_type: input.mimeType || null,
      size_bytes: input.sizeBytes,
      doc_type: docType,
      title: title ?? null,
      parsed: parsed ?? null,
      source,
      expiry_date: expiryDate ?? null,
      tags: normalizeTags(tags),
      metadata: metadata ?? {},
      uploaded_by: user.id,
      ...(folderId ? { folder_id: folderId } : {}),
    })
    .select()
    .single();

  if (insErr || !data) {
    // Roll back the orphaned storage object so we don't leak files.
    if (storedInR2) await requestDocumentStorage({ op: 'delete', bucket: DOCUMENTS_BUCKET, path });
    else await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw new Error('Could not save the document. Please try again.');
  }

  // FLUX-150: upload stays online-only, but pull the new row into the local
  // store immediately rather than waiting for the next fallback sync.
  void syncState(documents$(groupId)).sync();

  return data as Document;
}

/**
 * Put a new document straight into R2 when the server offers it. false means
 * the caller should upload to Supabase Storage instead: R2 isn't configured,
 * the server couldn't be asked, or the R2 upload itself failed.
 */
async function uploadToR2(path: string, input: DocumentUploadInput): Promise<boolean> {
  const reply = await requestDocumentStorage({
    op: 'upload',
    bucket: DOCUMENTS_BUCKET,
    path,
    mimeType: input.mimeType ?? undefined,
    sizeBytes: input.sizeBytes,
  });
  // The server knows this household's cap; a refusal is final, not a fallback.
  if (reply?.provider === 'refused') throw new Error(reply.error);
  const env = getDocumentStorage();
  if (reply?.provider !== 'r2' || !reply.url || !env) return false;
  try {
    const status = await env.putFile(reply.url, reply.headers ?? {}, { body: input.body, uri: input.uri });
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}

/**
 * Register an existing storage object as a `documents` row WITHOUT re-uploading.
 * Used by the grocery flow: the FLUX-95 pipeline already uploaded the receipt to
 * the cost-documents bucket — we register it in the store pointing at that same
 * object so groceries appear in the store without a second upload or an orphan.
 */
export interface RegisterDocumentArgs {
  supabase: SupabaseClient;
  groupId: string;
  storagePath: string;
  filename: string;
  docType: DocType;
  source: DocumentSource;
  mimeType?: string | null;
  sizeBytes?: number | null;
  title?: string;
  parsed?: unknown;
  expiryDate?: string | null;  // FLUX-113
  tags?: string[];             // FLUX-113
  metadata?: Record<string, unknown>;  // FLUX-133
}

export async function registerDocument({
  supabase,
  groupId,
  storagePath,
  filename,
  docType,
  source,
  mimeType,
  sizeBytes,
  title,
  parsed,
  expiryDate,
  tags,
  metadata,
}: RegisterDocumentArgs): Promise<Document> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('documents')
    .insert({
      group_id: groupId,
      storage_path: storagePath,
      filename,
      mime_type: mimeType ?? null,
      size_bytes: sizeBytes ?? null,
      doc_type: docType,
      title: title ?? null,
      parsed: parsed ?? null,
      source,
      expiry_date: expiryDate ?? null,
      tags: normalizeTags(tags),
      metadata: metadata ?? {},
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (error || !data) throw new Error('Could not register the document.');

  // FLUX-150: same as uploadDocument — pull the newly-registered row into the
  // local store right away instead of waiting for the next fallback sync.
  void syncState(documents$(groupId)).sync();

  return data as Document;
}

export interface LinkDocumentArgs {
  supabase: SupabaseClient;
  documentId: string;
  groupId: string;
  entityType: DocumentEntityType;
  entityId: string;
  linkRole?: string;
}

/** Attach a document to a service. Idempotent via the UNIQUE constraint. */
export async function linkDocument({
  supabase,
  documentId,
  groupId,
  entityType,
  entityId,
  linkRole,
}: LinkDocumentArgs): Promise<DocumentLink> {
  const { data, error } = await supabase
    .from('document_links')
    .upsert(
      {
        document_id: documentId,
        group_id: groupId,
        entity_type: entityType,
        entity_id: entityId,
        link_role: linkRole ?? null,
      },
      { onConflict: 'document_id,entity_type,entity_id' }
    )
    .select()
    .single();

  if (error || !data) throw new Error('Could not link the document.');
  return data as DocumentLink;
}

/** Remove a single document↔service link (leaves the document in the store). */
export async function unlinkDocument(
  supabase: SupabaseClient,
  link: Pick<DocumentLink, 'document_id' | 'entity_type' | 'entity_id'>
): Promise<void> {
  await supabase
    .from('document_links')
    .delete()
    .eq('document_id', link.document_id)
    .eq('entity_type', link.entity_type)
    .eq('entity_id', link.entity_id);
}

export interface ListDocumentsFilters {
  docType?: DocType;
  source?: DocumentSource;
}

/** List all of a group's documents, newest first, with optional filters. */
export async function listDocuments(
  supabase: SupabaseClient,
  groupId: string,
  filters?: ListDocumentsFilters
): Promise<Document[]> {
  let query = supabase
    .from('documents')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (filters?.docType) query = query.eq('doc_type', filters.docType);
  if (filters?.source) query = query.eq('source', filters.source);

  const { data } = await query;
  return (data ?? []) as Document[];
}

/** Distinct tags used across a group's documents — for tag autocomplete (FLUX-114). */
export async function listDocumentTags(
  supabase: SupabaseClient,
  groupId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('documents')
    .select('tags')
    .eq('group_id', groupId);
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ tags: string[] | null }>) {
    for (const t of row.tags ?? []) set.add(t);
  }
  return [...set].sort();
}

/** All document links for a group — for resolving link chips in the browse view. */
export async function listLinksForGroup(
  supabase: SupabaseClient,
  groupId: string
): Promise<DocumentLink[]> {
  const { data } = await supabase
    .from('document_links')
    .select('*')
    .eq('group_id', groupId);
  return (data ?? []) as DocumentLink[];
}

/** List the documents linked to one service (e.g. a cost item), newest first. */
export async function listDocumentsForEntity(
  supabase: SupabaseClient,
  entityType: DocumentEntityType,
  entityId: string
): Promise<Document[]> {
  const { data } = await supabase
    .from('document_links')
    .select('documents(*)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });

  return ((data ?? [])
    .map((row) => (row as unknown as { documents: Document | null }).documents)
    .filter((d): d is Document => d != null));
}

/** Storage paths of a cost item's legacy cost_documents — for dedup on the cost card. */
export async function listCostDocumentPaths(
  supabase: SupabaseClient,
  costItemId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('cost_documents')
    .select('storage_path')
    .eq('cost_item_id', costItemId);
  return (data ?? []).map((r) => (r as { storage_path: string }).storage_path);
}

// ── Read-merge (FLUX-106) ────────────────────────────────────────────────────
// The store doesn't own legacy files (cost_documents, warranty_files, grocery
// receipts) — those silos still exist. listUnifiedDocuments surfaces EVERYTHING
// in /documents by unioning store rows with live legacy rows, deduped by storage
// path (a store row wins, since it's richer/manageable). Legacy entries are
// open-only and carry the service they belong to as a static chip.

export interface UnifiedDocument {
  key: string;                 // stable react key
  storeId: string | null;      // documents.id when a real store row, else null (legacy)
  title: string | null;
  filename: string;
  docType: string;             // DocType for store rows; legacy kind/doc_type otherwise
  source: DocumentSource;
  createdAt: string;
  storagePath: string;
  bucket: string;
  legacy: boolean;
  groupId: string;
  expiryDate: string | null;   // FLUX-113: store rows only; legacy entries are null
  tags: string[];               // FLUX-113: store rows only; legacy entries are empty
  metadata: Record<string, unknown>;  // FLUX-133: store rows only; legacy entries are empty
  uploadedBy: string | null;   // FLUX-125: store rows only; legacy entries are null
  /** Filing folder; null = root. Always null for legacy entries, which have
   *  no store row to record a folder on and so always read as root. */
  folderId: string | null;
  /** For legacy entries: the service this file belongs to (rendered as a static chip). */
  impliedEntity?: { type: DocumentEntityType; id: string };
}

/** Which legacy silos listUnifiedDocuments merges in. Both default to on. */
export interface UnifiedLegacySources {
  /** Legacy cost_documents. Pass `documents.costs` (module-features.ts). */
  costs?: boolean;
  /** Legacy grocery receipts. Pass `documents.groceries` (module-features.ts). */
  groceries?: boolean;
}

/**
 * List a group's unified documents. `storeRows`, when provided, is used in
 * place of a fresh `documents`-table fetch for the native-row portion — FLUX-150
 * passes the `documents$` Legend store's current (offline-first) rows here so
 * the native portion no longer needs a network round-trip. The legacy
 * cost_documents/grocery-receipt merge below is untouched either way.
 * `legacy` drops a legacy silo (and skips its query) when the module that owns
 * it is switched off.
 */
export async function listUnifiedDocuments(
  supabase: SupabaseClient,
  groupId: string,
  storeRows?: Document[],
  legacy: UnifiedLegacySources = {}
): Promise<UnifiedDocument[]> {
  const out: UnifiedDocument[] = [];
  const seen = new Set<string>(); // storage paths already represented

  // Store rows first — they win on dedup.
  const store = storeRows ?? (await listDocuments(supabase, groupId));
  for (const d of store) {
    if (d.deleted) continue;
    seen.add(d.storage_path);
    out.push({
      key: `store:${d.id}`, storeId: d.id, title: d.title, filename: d.filename,
      docType: d.doc_type, source: d.source, createdAt: d.created_at,
      storagePath: d.storage_path, bucket: documentBucket(d.source), legacy: false, groupId: d.group_id,
      expiryDate: d.expiry_date, tags: d.tags ?? [], metadata: d.metadata ?? {}, uploadedBy: d.uploaded_by,
      folderId: d.folder_id ?? null,
    });
  }

  // Legacy cost_documents (group via the parent cost_item).
  // Modules: legacy bill files need documents and costs (module-features.ts).
  const { data: costDocs } = legacy.costs === false
    ? { data: [] }
    : await supabase
        .from('cost_documents')
        .select('id, storage_path, filename, doc_type, created_at, cost_item_id, cost_items!inner(group_id)')
        .eq('cost_items.group_id', groupId);
  for (const r of (costDocs ?? []) as Array<{ id: string; storage_path: string; filename: string; doc_type: string; created_at: string; cost_item_id: string }>) {
    if (seen.has(r.storage_path)) continue;
    seen.add(r.storage_path);
    out.push({
      key: `cost_documents:${r.id}`, storeId: null, title: null, filename: r.filename,
      docType: r.doc_type, source: 'cost', createdAt: r.created_at,
      storagePath: r.storage_path, bucket: COST_DOCUMENTS_BUCKET, legacy: true, groupId,
      expiryDate: null, tags: [], metadata: {}, uploadedBy: null, folderId: null,
      impliedEntity: { type: 'cost_item', id: r.cost_item_id },
    });
  }

  // Legacy grocery receipts (grocery_sessions.receipt_path, cost-documents bucket).
  // Modules: grocery receipts as documents need documents and groceries (module-features.ts).
  const { data: sessions } = legacy.groceries === false
    ? { data: [] }
    : await supabase
        .from('grocery_sessions')
        .select('id, receipt_path, receipt_name, created_at')
        .eq('group_id', groupId)
        .not('receipt_path', 'is', null);
  for (const r of (sessions ?? []) as Array<{ id: string; receipt_path: string; receipt_name: string | null; created_at: string }>) {
    if (seen.has(r.receipt_path)) continue;
    seen.add(r.receipt_path);
    out.push({
      key: `grocery_sessions:${r.id}`, storeId: null, title: null, filename: r.receipt_name ?? 'Receipt',
      docType: 'receipt', source: 'grocery', createdAt: r.created_at,
      storagePath: r.receipt_path, bucket: COST_DOCUMENTS_BUCKET, legacy: true, groupId,
      expiryDate: null, tags: [], metadata: {}, uploadedBy: null, folderId: null,
      impliedEntity: { type: 'grocery_session', id: r.id },
    });
  }

  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

// Legacy file silos live in their own buckets; documents registered into the
// store from those flows (grocery receipts, FLUX-106 cost/warranty dual-writes)
// point at the SAME object without re-upload. `source` is the discriminator —
// use it to resolve the right bucket.
const COST_DOCUMENTS_BUCKET = 'cost-documents';

/** The storage bucket a document's object actually lives in. */
export function documentBucket(source: DocumentSource): string {
  switch (source) {
    case 'grocery':
    case 'cost':
      return COST_DOCUMENTS_BUCKET;
    default:
      return DOCUMENTS_BUCKET;
  }
}

// HOUP-291: URLs are minted fresh on every view and consumed once (an
// embedded <img>/PDF fetch), so nothing depends on a long lifetime — 5
// minutes leaves headroom for a slow first paint while minimizing the window
// a leaked URL stays valid. Every signed-URL call site must reference this
// constant rather than a bare TTL number.
export const SIGNED_URL_TTL_SECONDS = 300;

/** Mint a short-lived signed URL to view a stored document (default 5 min). */
export async function signedDocumentUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresIn = SIGNED_URL_TTL_SECONDS,
  bucket: string = DOCUMENTS_BUCKET
): Promise<string | null> {
  // Hosted: the R2 copy when there is one (.docs/r2-storage.md).
  if (bucket === DOCUMENTS_BUCKET) {
    const reply = await requestDocumentStorage({ op: 'view', bucket, path: storagePath });
    if (reply?.provider === 'r2' && reply.url) return reply.url;
  }
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Signed URL for a document row, resolving its bucket from `source`. */
export function signedUrlForDocument(
  supabase: SupabaseClient,
  doc: Pick<Document, 'storage_path' | 'source'>,
  expiresIn = SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  return signedDocumentUrl(supabase, doc.storage_path, expiresIn, documentBucket(doc.source));
}

/** Rename a document's user-facing title. */
export async function renameDocument(
  supabase: SupabaseClient,
  documentId: string,
  title: string
): Promise<void> {
  await supabase
    .from('documents')
    .update({ title: title.trim() || null })
    .eq('id', documentId);
}

/**
 * Update a document's filing metadata (category, tags, expiry). Any group member
 * may recategorise/retag a shared document (RLS allows update group-wide); pass
 * only the fields you want to change. Tags are normalised before write.
 */
export interface UpdateDocumentMetadataArgs {
  docType?: DocType;
  tags?: string[];
  expiryDate?: string | null;
  title?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Pure transform: a UI-facing metadata patch → raw `documents` row fields.
 * FLUX-150: shared by `updateDocumentMetadata` (Supabase-direct) and the
 * Documents page's Legend `patchRow` write, so the field mapping lives once.
 */
export function documentMetadataPatch(patch: UpdateDocumentMetadataArgs): Partial<Document> {
  const update: Partial<Document> = {};
  if (patch.docType !== undefined) update.doc_type = patch.docType;
  if (patch.tags !== undefined) update.tags = normalizeTags(patch.tags);
  if (patch.expiryDate !== undefined) update.expiry_date = patch.expiryDate || null;
  if (patch.title !== undefined) update.title = patch.title.trim() || null;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;
  return update;
}

export async function updateDocumentMetadata(
  supabase: SupabaseClient,
  documentId: string,
  patch: UpdateDocumentMetadataArgs
): Promise<void> {
  const update = documentMetadataPatch(patch);
  if (Object.keys(update).length === 0) return;

  await supabase.from('documents').update(update).eq('id', documentId);
}

/**
 * Delete a document: remove the storage object and soft-delete the row.
 * Only remove the storage object when it lives in the `documents` bucket —
 * objects in legacy buckets (grocery/cost/warranty) are owned by their legacy
 * tables, so we drop only the store row. The row itself is tombstoned
 * (`deleted: true`) through the Legend store, not hard-deleted — the
 * Documents page reads from `documents$`, and a hard Supabase delete leaves
 * the row alive in IndexedDB, resurrecting it on next paint (FLUX-150 review).
 */
export async function deleteDocument(
  supabase: SupabaseClient,
  doc: Pick<Document, 'id' | 'storage_path' | 'source' | 'group_id'>
): Promise<void> {
  if (documentBucket(doc.source) === DOCUMENTS_BUCKET) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
    // The R2 copy too, if the file has one (a no-op elsewhere).
    await requestDocumentStorage({ op: 'delete', bucket: DOCUMENTS_BUCKET, path: doc.storage_path });
  }
  const store$ = documents$(doc.group_id) as unknown as Record<string, Observable<Document>>;
  store$[doc.id].assign({ deleted: true });
}

// ── Legacy file management (FLUX-138) ────────────────────────────────────────
// Legacy files (cost_documents / warranty_files / grocery receipts) surface
// read-only in /documents via the read-merge. These let a user promote one into
// the store (so it becomes editable) or delete it from its owning origin.

/** Coerce a legacy doc_type string into a valid store DocType. */
function coerceDocType(raw: string): DocType {
  if (raw === 'bill') return 'invoice';
  if (raw in DOC_TYPE_META && raw !== 'bill') return raw as DocType;
  return 'other';
}

/**
 * Adopt a legacy file into the store: register a `documents` row pointing at the
 * same storage object (no re-upload) and re-link it to its origin service, so it
 * gains full store controls (rename/category/expiry/tags/links). Idempotent-ish:
 * the read-merge dedups by storage path, so the new store row supersedes the
 * legacy entry.
 */
export async function adoptLegacyDocument(
  supabase: SupabaseClient,
  doc: UnifiedDocument
): Promise<Document> {
  const row = await registerDocument({
    supabase,
    groupId: doc.groupId,
    storagePath: doc.storagePath,
    filename: doc.filename,
    docType: coerceDocType(doc.docType),
    source: doc.source,
  });
  if (doc.impliedEntity) {
    await linkDocument({
      supabase, documentId: row.id, groupId: doc.groupId,
      entityType: doc.impliedEntity.type, entityId: doc.impliedEntity.id,
    });
  }
  return row;
}

/**
 * Delete a legacy file from its owning origin (the store doesn't own it). Removes
 * the storage object and clears/deletes the origin reference per legacy kind.
 */
export async function deleteLegacyDocument(
  supabase: SupabaseClient,
  doc: UnifiedDocument
): Promise<void> {
  const sep = doc.key.indexOf(':');
  const table = doc.key.slice(0, sep);
  const id = doc.key.slice(sep + 1);

  await supabase.storage.from(doc.bucket).remove([doc.storagePath]);

  if (table === 'cost_documents') {
    await supabase.from('cost_documents').delete().eq('id', id);
  } else if (table === 'grocery_sessions') {
    await supabase.from('grocery_sessions').update({ receipt_path: null, receipt_name: null }).eq('id', id);
  }
}

// ── Browse-view pure helpers (HOUP-83) ──────────────────────────────────────
// Lifted out of apps/web/src/app/documents/page.tsx so the native Documents
// list can reuse the exact same filter/preset/grouping logic rather than
// re-typing it. Pure — no React/DOM dependency.

export const SOURCE_LABEL: Record<DocumentSource, string> = {
  capture: 'Capture', cost: 'Costs', warranty: 'Warranties', grocery: 'Groceries', other: 'Other',
};

export const TYPE_FILTERS: DocType[] = [
  'invoice', 'receipt', 'warranty', 'manual', 'contract', 'photo',
  'id_personal', 'insurance', 'lease_contract', 'tax_financial', 'medical', 'vehicle', 'appliance_manual', 'other',
];

/** "Expiring soon" window for the grouped section (FLUX-118). */
export const SOON_DAYS = 30;

/** Quick-filter presets (FLUX-135): one tap selects a category set. */
export const PRESETS: { label: string; types: DocType[] }[] = [
  { label: 'Warranties', types: ['warranty', 'appliance_manual'] },
  { label: 'Insurance', types: ['insurance'] },
  { label: 'Vehicle', types: ['vehicle'] },
  { label: 'Leases', types: ['lease_contract'] },
  { label: 'IDs', types: ['id_personal'] },
  { label: 'Receipts', types: ['receipt', 'invoice'] },
];

export const sameSet = (a: Set<DocType>, b: DocType[]) =>
  a.size === b.length && b.every((t) => a.has(t));

/** Whole days until a doc's expiry (negative = expired), or null when no expiry. */
export function expiryDaysOf(d: Pick<UnifiedDocument, 'expiryDate'>): number | null {
  return d.expiryDate ? Math.ceil((new Date(d.expiryDate).getTime() - Date.now()) / 86_400_000) : null;
}

/**
 * Expiry state across a set of documents, for a Documents Hero lede's
 * caption: how many have expired, and how many are still valid but expire
 * within SOON_DAYS.
 */
export function documentExpiryCounts(docs: Pick<UnifiedDocument, 'expiryDate'>[]): { soon: number; expired: number } {
  let soon = 0;
  let expired = 0;
  for (const d of docs) {
    const n = expiryDaysOf(d);
    if (n == null) continue;
    if (n < 0) expired += 1;
    else if (n <= SOON_DAYS) soon += 1;
  }
  return { soon, expired };
}

/** One labelled run of documents on a Documents list, under its folders. */
export interface DocumentListSection<T> {
  key: 'soon' | 'files';
  /** The section's micro label. */
  label: string;
  docs: T[];
}

/**
 * The sections a Documents list shows under its folders, so web and mobile
 * split and label it the same way. With `splitSoon`, anything expired or
 * expiring within SOON_DAYS leads as "Expiring soon"; everything else is
 * "Files". Order inside each section is kept and empty sections are dropped.
 * Callers pass splitSoon only when the list isn't already filtered or sorted
 * by expiry, where a separate soon section would just repeat the list.
 */
export function documentListSections<T extends Pick<UnifiedDocument, 'expiryDate'>>(
  docs: T[],
  splitSoon: boolean
): DocumentListSection<T>[] {
  if (!splitSoon) return docs.length > 0 ? [{ key: 'files', label: 'Files', docs }] : [];
  const soon: T[] = [];
  const rest: T[] = [];
  for (const d of docs) {
    const n = expiryDaysOf(d);
    (n != null && n <= SOON_DAYS ? soon : rest).push(d);
  }
  const sections: DocumentListSection<T>[] = [];
  if (soon.length > 0) sections.push({ key: 'soon', label: 'Expiring soon', docs: soon });
  if (rest.length > 0) sections.push({ key: 'files', label: 'Files', docs: rest });
  return sections;
}

export function serviceLabel(type: DocumentEntityType, id: string, costNames: Record<string, string>): string {
  switch (type) {
    case 'cost_item': return costNames[id] ?? 'Cost item';
    case 'grocery_session': return 'Groceries';
    case 'setup_item': return 'Setup';
    case 'recipe': return 'Recipe';
    case 'event': return 'Event';
    default: return type;
  }
}

/** Where a document's link chip goes: the linked recipe itself, otherwise the
 *  linked item's section. Both apps' documents screens use it. */
export function documentLinkHref(link: Pick<DocumentLink, 'entity_type' | 'entity_id'>): string {
  switch (link.entity_type) {
    case 'cost_item': return '/costs';
    case 'grocery_session': return '/groceries';
    case 'setup_item': return '/setup';
    case 'event': return '/calendar';
    case 'recipe': return `/recipes/${link.entity_id}`;
  }
}

// ── Module gates (module-features.ts) ────────────────────────────────────────
// Both apps' documents screens and capture flows decide what to show from
// these, so web and mobile drop the same links and categories.

/** The cross-module feature each kind of document link needs. */
const DOCUMENT_LINK_FEATURE: Record<DocumentEntityType, ModuleFeatureId> = {
  cost_item: 'documents.costs',
  grocery_session: 'documents.groceries',
  setup_item: 'documents.setup',
  event: 'calendar.event-documents',
  recipe: 'documents.recipes',
};

/** The links to show on a document: a link into a switched-off module is
 *  dropped (the row stays stored). `feature` is useModules().feature. */
export function visibleDocumentLinks<T extends Pick<DocumentLink, 'entity_type'>>(
  links: T[],
  feature: (id: ModuleFeatureId) => boolean
): T[] {
  return links.filter((l) => feature(DOCUMENT_LINK_FEATURE[l.entity_type]));
}

/** The categories a capture or share can file a file under (web capture
 *  sheet, mobile CaptureFlow), each with the features it writes through.
 *  An invoice adds a cost and files the bill as a document linked to it, so
 *  it needs Documents as well as Costs. */
export const CAPTURE_CATEGORY_FEATURES = {
  document: ['capture.document'],
  other: ['capture.document'],
  invoice: ['capture.cost', 'documents.costs'],
  grocery: ['capture.grocery-bill'],
  apartment: ['capture.listing'],
} as const satisfies Record<string, readonly ModuleFeatureId[]>;

export type CaptureCategoryId = keyof typeof CAPTURE_CATEGORY_FEATURES;

/** Whether a capture or share category is offered. `feature` is useModules().feature. */
export function isCaptureCategoryEnabled(
  id: CaptureCategoryId,
  feature: (id: ModuleFeatureId) => boolean
): boolean {
  return CAPTURE_CATEGORY_FEATURES[id].every((f) => feature(f));
}
