// FLUX-98 / FLUX-103 / HOUP-83: thin web facade over @homeup/core's documents
// module. The platform-agnostic CRUD/query/upload logic now lives in
// packages/core/src/documents.ts (shared with apps/mobile) — this file
// re-exports it and keeps the browser-only bits: `File`-based validation, the
// `<input accept>` string, and a `File → DocumentUploadInput` adapter so
// `uploadDocument`'s call sites (capture-sheet.tsx, recipe-capture.ts,
// calendar/event-modal.tsx) are unchanged.
//
// Land here first for anything touching document storage from web code —
// mirrors the warranty-files.ts template; additive, does not replace the
// legacy cost_documents / warranty_files / grocery receipt silos (FLUX-106
// unifies via `listUnifiedDocuments`, re-exported below).

import {
  uploadDocument as coreUploadDocument,
  validateDocumentMeta,
  type DocumentUploadInput,
  type UploadDocumentArgs as CoreUploadDocumentArgs,
} from '@homeup/core';

export {
  DOC_TYPE_META,
  docTypeLabel,
  DOC_TYPE_PICKER_OPTIONS,
  DOCUMENTS_BUCKET,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_LABEL,
  DOCUMENT_ACCEPTED_TYPES,
  SIGNED_URL_TTL_SECONDS,
  normalizeTags,
  registerDocument,
  linkDocument,
  unlinkDocument,
  listDocuments,
  listDocumentTags,
  listLinksForGroup,
  listDocumentsForEntity,
  listCostDocumentPaths,
  listUnifiedDocuments,
  documentBucket,
  signedDocumentUrl,
  signedUrlForDocument,
  renameDocument,
  documentMetadataPatch,
  updateDocumentMetadata,
  deleteDocument,
  adoptLegacyDocument,
  deleteLegacyDocument,
} from '@homeup/core';

export type {
  RegisterDocumentArgs,
  LinkDocumentArgs,
  ListDocumentsFilters,
  UnifiedDocument,
  UpdateDocumentMetadataArgs,
} from '@homeup/core';

// `accept` attribute for <input type="file"> (images + PDF) — web-only, no RN equivalent.
export const DOCUMENT_ACCEPT_ATTR = 'image/*,application/pdf';

/** Returns an error message if the file is invalid, or null if it passes. */
export function validateDocumentFile(file: File): string | null {
  return validateDocumentMeta({ mimeType: file.type || null, sizeBytes: file.size });
}

export interface UploadDocumentArgs extends Omit<CoreUploadDocumentArgs, 'input'> {
  file: File;
}

/**
 * Validate, upload to the documents bucket, and record a `documents` row.
 * Keeps the original `file: File`-based signature so every web call site is
 * unchanged; adapts to core's platform-neutral `DocumentUploadInput` (HOUP-83).
 */
export async function uploadDocument({ file, ...rest }: UploadDocumentArgs) {
  return coreUploadDocument({ ...rest, input: fileUploadInput(file) });
}

/** A browser `File` as core's platform-neutral upload input. */
export function fileUploadInput(file: File): DocumentUploadInput {
  return {
    body: file,
    filename: file.name,
    mimeType: file.type || null,
    sizeBytes: file.size,
  };
}
