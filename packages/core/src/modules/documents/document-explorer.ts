// The Documents file explorer, shared by the web page's wide layout (folder
// tree, file table, preview pane) and the phone's file sheet: the folder
// tree's visible rows, and the facts a selected file shows beside its
// preview. Each app keeps its own rendering.

import type { DocumentFolder } from '../../types';
import { timeAgo } from '../../relative-time';
import { documentMetadataValue, metadataSummary } from './document-fields';
import { folderBreadcrumb, folderDocumentCount, foldersInParent, MAX_FOLDER_DEPTH } from './document-folders';
import { docTypeLabel, expiryDaysOf, type UnifiedDocument } from './documents';
import { documentExpiryLabel } from './document-list-view';

export interface FolderTreeRow {
  folder: DocumentFolder;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  /** Documents in the folder and everything under it. */
  count: number;
}

/**
 * The folder tree as flat rows, depth first and name sorted: every top-level
 * folder, then the children of each folder in `expanded`. A collapsed
 * folder's subtree is left out.
 */
export function folderTreeRows<T extends { folderId?: string | null }>(
  folders: DocumentFolder[],
  documents: T[],
  expanded: ReadonlySet<string>
): FolderTreeRow[] {
  const rows: FolderTreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    if (depth >= MAX_FOLDER_DEPTH) return;
    for (const folder of foldersInParent(folders, parentId)) {
      const hasChildren = folders.some((f) => f.parent_id === folder.id);
      const open = hasChildren && expanded.has(folder.id);
      rows.push({ folder, depth, hasChildren, expanded: open, count: folderDocumentCount(folders, documents, folder.id) });
      if (open) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** The folders that must be open for `folderId` to show in the tree: its ancestors, not itself. */
export function folderAncestorIds(folders: DocumentFolder[], folderId: string | null): string[] {
  return folderBreadcrumb(folders, folderId).slice(0, -1).map((f) => f.id);
}

/** Where a document is filed, as "House / Kitchen", or "Not in a folder". */
export function documentFolderPath(folders: DocumentFolder[], folderId: string | null): string {
  const path = folderBreadcrumb(folders, folderId);
  return path.length > 0 ? path.map((f) => f.name).join(' / ') : 'Not in a folder';
}

/**
 * A selected file's expiry, for the note over its details: "Expires in 21
 * days" in the soon or expired tone. Null when it has no expiry date.
 */
export function documentExpiryNote(
  doc: Pick<UnifiedDocument, 'expiryDate'>
): { text: string; tone: 'expired' | 'soon' | 'later' } | null {
  const days = expiryDaysOf(doc);
  if (days == null || !doc.expiryDate) return null;
  const { text, tone } = documentExpiryLabel(days, doc.expiryDate);
  const long = text.replace(/(\d+)d\b/, (_, n: string) => `${n} ${n === '1' ? 'day' : 'days'}`);
  return { text: long.charAt(0).toUpperCase() + long.slice(1), tone };
}

/**
 * The label and value lines under a selected file's preview: its type, its
 * category fields (maker, model, policy number), its folder, who added it and
 * when, and where it came from when that isn't a capture.
 */
export function documentDetailRows(
  doc: UnifiedDocument,
  opts: { folders: DocumentFolder[]; addedBy: string | null; origin: string | null }
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [{ label: 'Type', value: docTypeLabel(doc.docType) }];
  for (const f of metadataSummary(doc.docType, doc.metadata)) {
    rows.push({ label: f.label, value: documentMetadataValue(f.value) });
  }
  if (!doc.legacy) rows.push({ label: 'Folder', value: documentFolderPath(opts.folders, doc.folderId) });
  const added = timeAgo(doc.createdAt);
  const when = added ? added.replace(/^Just now$/, 'just now') : null;
  const addedLine = [opts.addedBy, when].filter(Boolean).join(', ');
  if (addedLine) rows.push({ label: 'Added', value: addedLine });
  if (opts.origin) rows.push({ label: 'From', value: opts.origin });
  return rows;
}

/**
 * What a file dropped straight into a folder is filed as, before anyone
 * edits it: a photo for an image, otherwise "Other", titled after its
 * filename without the extension.
 */
export function quickUploadFields(filename: string, mimeType: string | null): { docType: 'photo' | 'other'; title: string } {
  const title = filename.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').trim() || filename;
  return { docType: mimeType?.startsWith('image/') ? 'photo' : 'other', title };
}
