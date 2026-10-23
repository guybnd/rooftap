// Hierarchical filing for the Documents section. Adapted from
// Dorilan/ZuHause PR #12, which shipped the whole feature as ~290 lines inside
// apps/web's documents page; the tree logic lives here instead so both
// platforms share one implementation and the awkward parts (cycles,
// breadcrumbs, recursive counts) are testable without a database.
//
// Deliberate limits, both inherited from how documents already work rather
// than introduced here:
//  - Legacy documents (cost_documents / grocery receipts with no row in the
//    `documents` table) cannot be filed. There is no column to file them in
//    until they are adopted into the store. listFilableDocuments encodes that.
//  - New uploads land at root. The capture flow is shared across many sections
//    and is not folder-aware; filing afterwards is a move.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentFolder } from '../../types';
import { envRandomUUID } from '../../data/store-environment';

export const ROOT_FOLDER_ID = null;

/** Depth cap, matching the database trigger's hop limit. */
export const MAX_FOLDER_DEPTH = 100;

// ── Pure tree logic ─────────────────────────────────────────────────────────

/** Direct children of `parentId`, name-sorted for stable rendering. */
export function foldersInParent(
  folders: DocumentFolder[],
  parentId: string | null
): DocumentFolder[] {
  return folders
    .filter((f) => (f.parent_id ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Root-to-folder path, for the breadcrumb. Returns [] for the root.
 *
 * Defends against a cycle even though the database rejects them: a row written
 * before that trigger existed would otherwise hang the render loop.
 */
export function folderBreadcrumb(
  folders: DocumentFolder[],
  folderId: string | null
): DocumentFolder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: DocumentFolder[] = [];
  const seen = new Set<string>();

  let cursor: string | null = folderId;
  while (cursor && !seen.has(cursor) && path.length < MAX_FOLDER_DEPTH) {
    seen.add(cursor);
    const folder: DocumentFolder | undefined = byId.get(cursor);
    if (!folder) break;
    path.unshift(folder);
    cursor = folder.parent_id ?? null;
  }
  return path;
}

/** Every folder beneath `folderId`, excluding the folder itself. */
export function folderDescendantIds(folders: DocumentFolder[], folderId: string): Set<string> {
  const childrenOf = new Map<string | null, DocumentFolder[]>();
  for (const f of folders) {
    const key = f.parent_id ?? null;
    const list = childrenOf.get(key) ?? [];
    list.push(f);
    childrenOf.set(key, list);
  }

  const out = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (out.has(child.id)) continue; // cycle backstop
      out.add(child.id);
      queue.push(child.id);
    }
  }
  return out;
}

/**
 * Whether `folderId` may be reparented under `nextParentId`. A folder cannot
 * become its own parent or descend into its own subtree; either would detach
 * the subtree from the root.
 */
export function canMoveFolder(
  folders: DocumentFolder[],
  folderId: string,
  nextParentId: string | null
): boolean {
  if (nextParentId === null) return true;
  if (nextParentId === folderId) return false;
  return !folderDescendantIds(folders, folderId).has(nextParentId);
}

/** Folder options for a move picker, excluding any destination that would cycle. */
export function moveTargetsFor(
  folders: DocumentFolder[],
  movingFolderId: string | null
): DocumentFolder[] {
  const targets = movingFolderId
    ? folders.filter((f) => canMoveFolder(folders, movingFolderId, f.id))
    : folders;
  return [...targets].sort((a, b) => a.name.localeCompare(b.name));
}

/** One destination row in the move sheet: a folder and how deep it sits. */
export interface FolderMoveOption {
  folder: DocumentFolder;
  depth: number;
  /** Ancestor names, root first, so a search hit still says where it lives. */
  path: string[];
}

/**
 * The move sheet's destinations as an indented tree: depth-first, siblings
 * name-sorted, with any destination that would cycle left out. Dropping the
 * moving folder drops its whole subtree with it, which is exactly the set
 * canMoveFolder refuses.
 */
export function folderMoveOptions(
  folders: DocumentFolder[],
  movingFolderId: string | null
): FolderMoveOption[] {
  const out: FolderMoveOption[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number, path: string[]) => {
    if (depth >= MAX_FOLDER_DEPTH) return;
    for (const f of foldersInParent(folders, parentId)) {
      if (f.id === movingFolderId || seen.has(f.id)) continue; // cycle backstop
      seen.add(f.id);
      out.push({ folder: f, depth, path });
      walk(f.id, depth + 1, [...path, f.name]);
    }
  };
  walk(null, 0, []);
  return out;
}

/**
 * Documents filed directly in `folderId`. Legacy documents have no store row
 * and therefore no folder_id, so they always read as root.
 */
export function documentsInFolder<T extends { folderId?: string | null }>(
  documents: T[],
  folderId: string | null
): T[] {
  return documents.filter((d) => (d.folderId ?? null) === folderId);
}

/**
 * How many documents sit in a folder including its whole subtree, for the
 * folder row's count. A folder showing "0" while holding a full sub-folder
 * would read as empty.
 */
export function folderDocumentCount<T extends { folderId?: string | null }>(
  folders: DocumentFolder[],
  documents: T[],
  folderId: string
): number {
  const subtree = folderDescendantIds(folders, folderId);
  subtree.add(folderId);
  return documents.filter((d) => d.folderId != null && subtree.has(d.folderId)).length;
}

/**
 * A folder tile's one line of contents, documents first: "3 documents",
 * "3 documents · 1 folder", "2 folders", or "Empty". The document count
 * covers the whole subtree (folderDocumentCount); the folder count is the
 * direct children, the ones a tap on the tile shows. Both apps' folder tiles
 * print this, so they never disagree on what a folder holds.
 */
export function folderContentsLabel<T extends { folderId?: string | null }>(
  folders: DocumentFolder[],
  documents: T[],
  folderId: string
): string {
  const docs = folderDocumentCount(folders, documents, folderId);
  const subfolders = foldersInParent(folders, folderId).length;
  const parts: string[] = [];
  if (docs > 0) parts.push(`${docs} ${docs === 1 ? 'document' : 'documents'}`);
  if (subfolders > 0) parts.push(`${subfolders} ${subfolders === 1 ? 'folder' : 'folders'}`);
  return parts.length > 0 ? parts.join(' · ') : 'Empty';
}

/** Only store-backed documents can be filed; legacy ones have nowhere to record it. */
export function isFilable<T extends { legacy: boolean; storeId: string | null }>(doc: T): boolean {
  return !doc.legacy && !!doc.storeId;
}

// ── Supabase calls ──────────────────────────────────────────────────────────

/**
 * PostgREST's ways of saying "that table isn't there". 42P01 is Postgres's own
 * undefined_table; the PGRST codes are the schema-cache miss you actually get
 * back through the API.
 */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST106']);

function isMissingTable(error: { code?: string | null } | null): boolean {
  return !!error?.code && MISSING_TABLE_CODES.has(error.code);
}

/**
 * A group's folders, or [] when the folders table does not exist yet.
 *
 * Both Documents screens fetch this inside the same Promise.all as the
 * documents themselves, so throwing here takes the whole screen down rather
 * than just the folder rows. That matters because the app and the database
 * deploy independently: Vercel ships the web build and the Supabase
 * integration applies migrations off the same push, in no guaranteed order,
 * and mobile clients get JS over the air without a store release at all. A
 * client running ahead of its database has to degrade to the flat list, not
 * hang on a spinner.
 *
 * Only a missing table is swallowed. A permission or network failure is a
 * real error and still throws.
 */
export async function listDocumentFolders(
  supabase: SupabaseClient,
  groupId: string
): Promise<DocumentFolder[]> {
  const { data, error } = await supabase
    .from('document_folders')
    .select('*')
    .eq('group_id', groupId)
    .order('name');
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as DocumentFolder[];
}

/**
 * A new folder row built on the client with its final id, so a screen can
 * show it before the insert lands; pass the same id to createDocumentFolder.
 */
export function draftDocumentFolder(args: {
  groupId: string;
  name: string;
  parentId: string | null;
  createdBy: string;
}): DocumentFolder {
  const now = new Date().toISOString();
  return {
    id: envRandomUUID(),
    group_id: args.groupId,
    name: args.name.trim(),
    parent_id: args.parentId,
    created_by: args.createdBy,
    created_at: now,
    updated_at: now,
  };
}

export async function createDocumentFolder(
  supabase: SupabaseClient,
  args: { groupId: string; name: string; parentId: string | null; createdBy: string; id?: string }
): Promise<DocumentFolder> {
  const name = args.name.trim();
  if (!name) throw new Error('Folder name is required');

  const { data, error } = await supabase
    .from('document_folders')
    .insert({
      ...(args.id ? { id: args.id } : {}),
      group_id: args.groupId,
      name,
      parent_id: args.parentId,
      created_by: args.createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DocumentFolder;
}

export async function renameDocumentFolder(
  supabase: SupabaseClient,
  folderId: string,
  name: string
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');

  const { error } = await supabase
    .from('document_folders')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', folderId);
  if (error) throw error;
}

export async function moveDocumentFolder(
  supabase: SupabaseClient,
  folderId: string,
  nextParentId: string | null
): Promise<void> {
  const { error } = await supabase
    .from('document_folders')
    .update({ parent_id: nextParentId, updated_at: new Date().toISOString() })
    .eq('id', folderId);
  if (error) throw error;
}

/**
 * Delete a folder. Its sub-folders cascade, but every document underneath is
 * unfiled back to root first rather than deleted.
 *
 * The unfile is explicit rather than relying on the column's ON DELETE SET
 * NULL, because that only fires for documents in this folder — documents in
 * cascading sub-folders would be reassigned as those rows go, and the order is
 * not something to depend on.
 */
export async function deleteDocumentFolder(
  supabase: SupabaseClient,
  folders: DocumentFolder[],
  folderId: string
): Promise<void> {
  const affected = folderDescendantIds(folders, folderId);
  affected.add(folderId);

  const { error: unfileError } = await supabase
    .from('documents')
    .update({ folder_id: null })
    .in('folder_id', [...affected]);
  if (unfileError) throw unfileError;

  const { error } = await supabase.from('document_folders').delete().eq('id', folderId);
  if (error) throw error;
}

// Filing a document is deliberately not here: it is a folder_id write on a
// documents$ store row (patchRow), never a direct UPDATE. The store upserts
// whole rows, so a direct write is undone by the next store write of that
// document.
