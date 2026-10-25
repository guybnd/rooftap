'use client';

// FLUX-105 + FLUX-106: the documents store browse view, now showing a UNIFIED
// list — store documents (full controls: open, rename, delete, link management)
// plus legacy files (cost_documents / warranty_files / grocery receipts) surfaced
// read-only via read-merge, deduped by storage path. So every file in the group
// is visible here regardless of which surface uploaded it.

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDataCache } from '@/lib/data-cache';
import { useGroupTableRefetch } from '@/lib/hooks/use-group-table-realtime';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useMediaQuery, useWideLayout } from '@/lib/desktop-layout';
import { use$ } from '@legendapp/state/react';
import { listUnifiedDocuments, listLinksForGroup, deleteDocument, deleteLegacyDocument, adoptLegacyDocument, docTypeLabel, uploadDocument, DOCUMENT_ACCEPT_ATTR, type UnifiedDocument } from '@/lib/documents';
import { deleteDocumentReminder } from '@homeup/core';
import { dialog } from '@homeup/core';
import { DocumentsSectionLabel, FolderPath, NewFolderButton, ROW_LEAVE_MS } from '@/components/documents/folder-browser';
import { EmptyState } from '@/components/ui/empty-state';
import { useCapture } from '@/components/capture/capture-context';
import { commit as hapticCommit, warn as hapticWarn } from '@/lib/haptics';
import { FolderMoveSheet } from '@/components/documents/folder-move-sheet';
import { DocumentCalendarFlow, type CalendarDoc } from '@/components/documents/document-calendar-flow';
import { FolderDeleteSheet } from '@/components/documents/folder-delete-sheet';
import { Button } from '@/components/ui/button';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import {
  listDocumentFolders,
  createDocumentFolder,
  draftDocumentFolder,
  renameDocumentFolder,
  moveDocumentFolder,
  deleteDocumentFolder,
  folderDescendantIds,
  documentCostIds,
  documentLinksByDoc,
  documentReminderMap,
  groupDocumentsByCost,
  documentExpiryCounts,
  folderBreadcrumb,
  quickUploadFields,
  TYPE_FILTERS,
  PRESETS,
  sameSet,
  useDocumentListView,
  type DocumentFolder,
} from '@homeup/core';
import { documents$, useStoreHelpers, useReconnectSync, useStoreLoaded, useModules, visibleDocumentLinks, documentLinkHref } from '@homeup/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { listCostItems } from '@homeup/core';
import { ListGroup } from '@/components/ui/list-item';
import { HeroLede } from '@/components/ui/hero-lede';
import { SectionSearchBar } from '@/components/section-search-bar';
import { SegmentedControl, type SegmentOption } from '@/components/ui/segmented-control';
import type { Document, DocumentLink, CostItem } from '@homeup/core';
import { ArrowDown, ChevronDown, ChevronRight, FileText, FolderInput, FolderOpen, Loader2, MousePointerClick, Plus, SearchX, Trash2, Upload, X } from 'lucide-react';
import { DocumentCard, DOC_TABLE_COLUMNS } from './document-card';
import { DOC_DRAG_TYPE, FolderTableRow, FolderTree, type ExplorerView } from '@/components/documents/folder-tree';
import { DocumentInspector } from '@/components/documents/document-inspector';
const EXPIRY_OPTIONS: SegmentOption<'all' | 'soon' | 'expired'>[] = [
  { value: 'all', label: 'All' },
  { value: 'soon', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
];

// Filter controls reach a 44px touch target on phones (F), compact on desktop.
const CONTROL_H = 'h-11 sm:h-9';

// A filter chip: ~32px to the eye, padded to a 44px hit area on phones.
function FilterChip({
  active,
  onClick,
  children,
  ...rest
}: { active: boolean; onClick: () => void; children: React.ReactNode } & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'children'
>) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="group shrink-0 py-1.5 sm:py-0.5" {...rest}>
      <span
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors',
          active
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/70 text-muted-foreground group-hover:text-foreground'
        )}
      >
        {children}
      </span>
    </button>
  );
}

// useSearchParams needs a Suspense boundary for the static build.
export default function DocumentsPage() {
  return (
    <Suspense fallback={null}>
      <DocumentsView />
    </Suspense>
  );
}

/** A document or folder being filed, with where it sits now and its name. */
type MoveTarget = { kind: 'document' | 'folder'; id: string; from: string | null; name: string };

function DocumentsView() {
  const { group, memberProfiles, loading: cacheLoading } = useDataCache();
  const groupId = group?.id ?? null;

  // FLUX-150 slice 7: native `documents`-table rows come from the Legend
  // store (offline-first); the legacy cost_documents/grocery-receipt merge
  // below is untouched and still reads Supabase directly.
  useReconnectSync(documents$(groupId));
  const storeLoaded = useStoreLoaded(documents$(groupId));
  const nativeDocsNow = use$(() =>
    Object.values(documents$(groupId).get() ?? {}).filter((d): d is Document => !!d && !d.deleted)
  );
  // use$ rebuilds this array on every render, and `load` depends on it: kept
  // as is, every load's state updates re-render, rebuild it and load again,
  // forever (opening a preview froze the page). Only a change in the rows
  // makes a new array.
  const nativeDocsKey = JSON.stringify(nativeDocsNow);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nativeDocs = useMemo(() => nativeDocsNow, [nativeDocsKey]);

  const [docs, setDocs] = useState<UnifiedDocument[]>([]);
  const [links, setLinks] = useState<DocumentLink[]>([]);
  const [costItems, setCostItems] = useState<CostItem[]>([]);
  const [reminderByDoc, setReminderByDoc] = useState<Record<string, string>>({});
  // Set once the first load resolves and never reset — the native portion
  // repaints instantly from the store on every later refresh, so there is no
  // spinner-on-revisit (only the very first paint waits on the legacy fetch).
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Modules: bill links, cost grouping and legacy bill files need documents and
  // costs; legacy grocery receipts need documents and groceries; "Open reminder"
  // needs household and documents (module-features.ts).
  const modules = useModules();
  // "Add to calendar" on a document links it to an event or makes one from it.
  const calendarOn = modules.feature('calendar.event-documents');
  const [calendarDoc, setCalendarDoc] = useState<CalendarDoc | null>(null);
  const costsOn = modules.feature('documents.costs');
  const groceriesOn = modules.feature('documents.groceries');
  const reminderLinkOn = modules.feature('tasks.from-document');

  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  // The open folder lives in the URL, so browser and Android back climb out
  // one folder at a time instead of leaving the section, and a folder can be
  // linked. An id that isn't a folder (deleted, another group's) reads as
  // the top level once folders have loaded.
  const searchParams = useSearchParams();
  const folderParam = searchParams.get('folder');
  const folderId =
    folderParam && (loading || folders.some((f) => f.id === folderParam)) ? folderParam : null;
  // Search, filters and sort, and the folders and sections they leave
  // (shared with mobile's documents screen).
  const {
    categoryFilters,
    setCategoryFilters,
    toggleCategory,
    expiryFilter,
    setExpiryFilter,
    tagFilters,
    setTagFilters,
    toggleTagFilter,
    sort,
    setSort,
    search,
    setSearch,
    setTypesExpanded,
    typesOpen,
    clearAllFilters,
    browsing,
    childFolders,
    sortedDocs,
    sections,
    openFolder,
    ledeDocs,
    expiryCounts,
  } = useDocumentListView(docs, folders, folderId);
  const setFolderId = (id: string | null, opts?: { replace?: boolean }) => {
    const href = id ? `/documents?folder=${encodeURIComponent(id)}` : '/documents';
    if (opts?.replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };
  // What the move sheet is filing, and where it sits now. Kept after the
  // sheet closes so its title doesn't change mid-dismiss; moveOpen drives it.
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const startMove = (target: MoveTarget) => {
    setMoving(target);
    setMoveOpen(true);
  };

  // Select mode: a tap ticks a document instead of opening it, and the bar at
  // the foot files or deletes every ticked one at once. Keyed by the merged
  // list's key, so legacy files can be ticked too. Ticks survive browsing
  // between folders, so a selection can gather files from anywhere.
  const [selecting, setSelecting] = useState(false);
  const wide = useWideLayout();
  // The wide explorer's preview pane: the file it shows, by list key.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // The pane needs the wide layout at Tailwind's xl; narrower, the picked
  // file opens in a sheet instead (the phone's file sheet).
  const paneOpen = useMediaQuery('(min-width: 1280px)') && wide;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // What the bulk move sheet is filing, read when it opens so its title holds
  // while it dismisses (the selection clears the moment a folder is picked).
  const [bulkMove, setBulkMove] = useState<{ count: number; from: string | null | undefined }>({ count: 0, from: undefined });
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  // The folder the delete sheet is about, read when it opens and kept while
  // the sheet dismisses, by which time the folder is gone.
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const [deleteFolderOpen, setDeleteFolderOpen] = useState(false);

  const costNames = useMemo(
    () => Object.fromEntries(costItems.map((c) => [c.id, c.name])),
    [costItems]
  );

  const load = useCallback(async () => {
    if (!groupId) return;
    const supabase = createClient();
    const [d, l, c, reminders, f] = await Promise.all([
      listUnifiedDocuments(supabase, groupId, nativeDocs, { costs: costsOn, groceries: groceriesOn }),
      listLinksForGroup(supabase, groupId),
      costsOn ? listCostItems(supabase, groupId) : Promise.resolve([] as CostItem[]),
      supabase
        .from('household_tasks')
        .select('id, template_key')
        .eq('group_id', groupId)
        .like('template_key', 'doc-reminder:%'),
      listDocumentFolders(supabase, groupId),
    ]);
    setDocs(d);
    setLinks(l);
    setCostItems(c);
    setFolders(f);
    // Map doc id → reminder task id, so cards can surface "Open reminder".
    setReminderByDoc(documentReminderMap((reminders.data ?? []) as Array<{ id: string; template_key: string | null }>));
    setLoading(false);
  }, [groupId, nativeDocs, costsOn, groceriesOn]);

  useEffect(() => {
    load();
  }, [load]);

  // Live-refresh when document LINKS change in this group (FLUX-120) — native
  // document rows now repaint reactively via `nativeDocs`/`load`'s dependency
  // on it, so only the legacy-adjacent `document_links` table still needs a
  // realtime-triggered refetch here.
  useGroupTableRefetch({ table: 'document_links', groupId, refetch: () => load() });

  // ── Folder mutations. Each reloads rather than patching local state: the
  // document list is a merge of the store and two legacy tables, so a
  // hand-rolled optimistic patch would have to reproduce that merge.
  const withFolders = async (fn: (supabase: ReturnType<typeof createClient>) => Promise<void>) => {
    if (!groupId) return;
    try {
      await fn(createClient());
      await load();
    } catch (e) {
      console.error('Folder operation failed:', e);
    }
  };

  // Creating a folder shows it straight away: the row is drafted locally with
  // its final id and inserted in the background, instead of waiting on an
  // auth round trip, the insert and a reload of every document table before
  // anything appears. A failed insert takes it back out.
  const createFolder = async (name: string): Promise<DocumentFolder | null> => {
    if (!groupId) return null;
    const supabase = createClient();
    // getSession reads the stored session; getUser would ask the server.
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return null;
    const draft = draftDocumentFolder({ groupId, name, parentId: folderId, createdBy: userId });
    setFolders((prev) => [...prev, draft]);
    try {
      await createDocumentFolder(supabase, { groupId, name, parentId: folderId, createdBy: userId, id: draft.id });
      return draft;
    } catch (e) {
      setFolders((prev) => prev.filter((f) => f.id !== draft.id));
      console.error('Folder operation failed:', e);
      toast.error("Couldn't create that folder");
      return null;
    }
  };

  // Rename and delete apply locally first too; only a failure reloads.
  const renameFolder = (id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    void renameDocumentFolder(createClient(), id, name).catch((e) => {
      console.error('Folder operation failed:', e);
      toast.error("Couldn't rename that folder");
      void load();
    });
  };

  const removeFolder = (id: string, withDocuments: boolean) => {
    const affected = folderDescendantIds(folders, id);
    affected.add(id);
    const inside = (d: UnifiedDocument) => d.folderId != null && affected.has(d.folderId);
    setFolders((prev) => prev.filter((f) => !affected.has(f.id)));
    // Unfile the documents through the store as well: it upserts whole rows,
    // so a store row still naming the deleted folder would be pushed back.
    for (const d of docs) {
      if (d.storeId && inside(d)) patchRow(d.storeId, { folder_id: null });
    }
    if (withDocuments) {
      const doomed = docs.filter(inside);
      setDocs((prev) => prev.filter((d) => !inside(d)));
      void deleteDocuments(doomed);
    } else {
      setDocs((prev) => prev.map((d) => (inside(d) ? { ...d, folderId: null } : d)));
    }
    void deleteDocumentFolder(createClient(), folders, id).catch((e) => {
      console.error('Folder operation failed:', e);
      toast.error("Couldn't delete that folder");
      void load();
    });
  };

  const handleCreateFolder = (name: string) => void createFolder(name);

  // The sheet asks what happens to the documents inside; deleting them with
  // the folder takes a second, explicit confirm (FolderDeleteSheet).
  const handleDeleteFolder = (id: string) => {
    const subtree = folderDescendantIds(folders, id);
    subtree.add(id);
    hapticWarn();
    setDeleting({
      id,
      name: folders.find((f) => f.id === id)?.name ?? 'this folder',
      count: docs.filter((d) => d.folderId != null && subtree.has(d.folderId)).length,
    });
    setDeleteFolderOpen(true);
  };

  const deleteFolder = (withDocuments: boolean) => {
    const id = deleting?.id;
    if (!id) return;
    // Standing inside the folder being deleted (or under it) would leave the
    // view pointing at a folder that no longer exists.
    if (folderId === id || (folderId && folderDescendantIds(folders, id).has(folderId))) {
      setFolderId(null, { replace: true });
    }
    removeFolder(id, withDocuments);
  };

  // Documents move through the documents$ store, not a direct UPDATE. The
  // store syncs whole rows (updatePartial: false, written as an upsert), so a
  // direct folder_id write left the store holding the old folder, and the
  // next store write of that document (an edit, a reminder, a queued offline
  // change) pushed the old folder back and silently undid the move. The store
  // write is also instant and retried offline. Folders aren't a store table,
  // so folder moves still go direct.
  const { patchRow, seedRow } = useStoreHelpers(documents$(groupId), null);

  const applyMove = (target: MoveTarget, destination: string | null) => {
    if (target.kind === 'document') {
      patchRow(target.id, { folder_id: destination });
      // docs is load()'s merged list; patch it now rather than wait out
      // load's network round trip for the row to change folder.
      setDocs((prev) => prev.map((d) => (d.storeId === target.id ? { ...d, folderId: destination } : d)));
      return;
    }
    setFolders((prev) => prev.map((f) => (f.id === target.id ? { ...f, parent_id: destination } : f)));
    void withFolders((supabase) => moveDocumentFolder(supabase, target.id, destination));
  };

  // Filing choreography state: the row on its way out (folder:<id> or a
  // document key) and the folder row on screen that receives it.
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  const [receivingFolderId, setReceivingFolderId] = useState<string | null>(null);

  // A row filed out of the folder on screen first plays its exit, then the
  // data changes; a folder row on screen that receives it swells and washes so
  // the eye lands where it went. The toast says where it went and offers the
  // way back.
  const confirmMove = (target: MoveTarget, destination: string | null, destinationName: string) => {
    const rowKey = target.kind === 'folder' ? `folder:${target.id}` : docs.find((d) => d.storeId === target.id)?.key;
    // A search spans the whole tree, so there a moved row stays where it is.
    const leavesView = browsing && destination !== folderId && !!rowKey;
    const landsOnScreen = destination !== null && childFolders.some((f) => f.id === destination);
    const land = () => {
      applyMove(target, destination);
      setLeavingKey(null);
      hapticCommit();
      if (landsOnScreen) {
        setReceivingFolderId(destination);
        setTimeout(() => setReceivingFolderId(null), 450);
      }
    };
    if (leavesView && rowKey) {
      setLeavingKey(rowKey);
      setTimeout(land, ROW_LEAVE_MS);
    } else {
      land();
    }
    toast(`Moved to ${destinationName}`, {
      duration: 5000,
      action: { label: 'Undo', onClick: () => applyMove(target, target.from) },
    });
  };

  const handleMoveSelection = (destination: string | null) => {
    if (!moving) return;
    const name = destination ? (folders.find((f) => f.id === destination)?.name ?? 'folder') : 'All documents';
    confirmMove(moving, destination, name);
  };

  // "New folder" inside the move sheet: the folder is made where the user is
  // browsing, same as the header's New folder, and the item goes straight in.
  // Not through withFolders: its reload would merge the document list from
  // before the move and put the row back where it was.
  const handleCreateAndMove = (name: string) => {
    const target = moving;
    if (!target) return;
    // The folder appears at once; the item moves in once the insert lands,
    // since a document can't point at a folder the server hasn't stored yet.
    void createFolder(name).then((created) => {
      if (created) confirmMove(target, created.id, created.name);
    });
  };

  // Deletes documents already taken off the list: store rows (and their
  // reminders) and legacy files from their source. Failures put back what
  // the server still holds via the reload.
  const deleteDocuments = async (picked: UnifiedDocument[]) => {
    if (picked.length === 0) return;
    const supabase = createClient();
    const results = await Promise.allSettled(
      picked.map(async (d) => {
        if (d.storeId) {
          await deleteDocument(supabase, { id: d.storeId, storage_path: d.storagePath, source: d.source, group_id: d.groupId });
          await deleteDocumentReminder(supabase, d.groupId, d.storeId);
        } else {
          await deleteLegacyDocument(supabase, d);
        }
      })
    );
    const failed = results.filter((res) => res.status === 'rejected').length;
    if (failed > 0) {
      console.error('Deleting documents failed:', results);
      toast.error(failed === 1 ? "Couldn't delete one document" : `Couldn't delete ${failed} documents`);
    }
    await load();
  };

  // A single delete leaves the list at once, like a batch delete: the
  // storage removal, reminder cleanup and reload run behind it, and a
  // failure puts the row back through that reload.
  const dropNow = (doc: UnifiedDocument) => {
    setDocs((prev) => prev.filter((d) => d.key !== doc.key));
    void deleteDocuments([doc]);
  };

  const selectedDocs = useMemo(() => docs.filter((d) => selectedKeys.has(d.key)), [docs, selectedKeys]);

  const startSelect = (doc: UnifiedDocument) => {
    setSelecting(true);
    setSelectedKeys(new Set([doc.key]));
  };

  const exitSelect = () => {
    setSelecting(false);
    setSelectedKeys(new Set());
  };

  const toggleSelect = (doc: UnifiedDocument) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(doc.key)) next.delete(doc.key);
      else next.add(doc.key);
      return next;
    });

  // Escape ends select mode, the way back does on Android. While the move
  // sheet is up, Escape is the sheet's.
  useEffect(() => {
    if (!selecting || bulkMoveOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setSelecting(false);
        setSelectedKeys(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, bulkMoveOpen]);

  const countLabel = (n: number) => (n === 1 ? '1 document' : `${n} documents`);

  // Files every picked document into one folder. Store rows move at once;
  // legacy files are adopted first, then filed, same as a single move. One
  // toast covers the lot, and its Undo puts each back where it was.
  const fileDocuments = async (picked: UnifiedDocument[], destination: string | null, destinationName: string) => {
    if (picked.length === 0) return;
    const moved: { id: string; from: string | null }[] = [];
    for (const d of picked) {
      if (!d.storeId) continue;
      moved.push({ id: d.storeId, from: d.folderId ?? null });
      patchRow(d.storeId, { folder_id: destination });
    }
    const movedKeys = new Set(picked.filter((d) => d.storeId).map((d) => d.key));
    setDocs((prev) => prev.map((d) => (movedKeys.has(d.key) ? { ...d, folderId: destination } : d)));
    hapticCommit();
    if (destination !== null && childFolders.some((f) => f.id === destination)) {
      setReceivingFolderId(destination);
      setTimeout(() => setReceivingFolderId(null), 450);
    }
    const legacy = picked.filter((d) => !d.storeId);
    if (legacy.length > 0) {
      const supabase = createClient();
      const rows = await Promise.all(
        legacy.map((d) =>
          adoptLegacyDocument(supabase, d).catch((e) => {
            console.error('Adopting a legacy file failed:', e);
            return null;
          })
        )
      );
      for (const row of rows) {
        if (!row) continue;
        seedRow(row);
        patchRow(row.id, { folder_id: destination });
        moved.push({ id: row.id, from: null });
      }
      if (rows.some((row) => !row)) toast.error("Couldn't move some files from bills and receipts");
    }
    if (moved.length === 0) return;
    toast(`Moved ${countLabel(moved.length)} to ${destinationName}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          const fromById = new Map(moved.map((m) => [m.id, m.from]));
          for (const m of moved) patchRow(m.id, { folder_id: m.from });
          setDocs((prev) =>
            prev.map((d) => (d.storeId && fromById.has(d.storeId) ? { ...d, folderId: fromById.get(d.storeId) ?? null } : d))
          );
        },
      },
    });
  };

  // The move sheet checks where the ticked documents sit, when they all sit
  // in one place; spread across folders, no row is current.
  const openBulkMove = () => {
    const places = new Set(selectedDocs.map((d) => d.folderId ?? null));
    setBulkMove({ count: selectedDocs.length, from: places.size === 1 ? [...places][0] : undefined });
    setBulkMoveOpen(true);
  };

  const moveSelected = (destination: string | null) => {
    const picked = selectedDocs;
    exitSelect();
    const name = destination ? (folders.find((f) => f.id === destination)?.name ?? 'folder') : 'All documents';
    void fileDocuments(picked, destination, name);
  };

  const createAndMoveSelected = (name: string) => {
    const picked = selectedDocs;
    exitSelect();
    void createFolder(name).then((created) => {
      if (created) void fileDocuments(picked, created.id, created.name);
    });
  };

  const deleteSelected = async () => {
    const picked = selectedDocs;
    if (picked.length === 0) return;
    const fromSources = picked.some((d) => !d.storeId);
    // A centre dialog is correct here per Hearth M4: destructive confirm.
    const detail = fromSources
      ? 'Files from bills and receipts are removed from those too.'
      : 'They are deleted for everyone in the household.';
    const confirmed = await dialog.confirm({
      title: `Delete ${countLabel(picked.length)}?`,
      message: `${detail} This can’t be undone.`,
      destructive: true,
    });
    if (!confirmed) return;
    exitSelect();
    const keys = new Set(picked.map((d) => d.key));
    setDocs((prev) => prev.filter((d) => !keys.has(d.key)));
    void deleteDocuments(picked);
  };

  // Links into a switched-off module don't render (and don't pair by cost).
  const linksByDoc = useMemo(() => documentLinksByDoc(visibleDocumentLinks(links, modules.feature)), [links, modules]);

  // FLUX-135: map each doc → its (first) linked cost, for paired-by-cost display.
  const costIdByKey = useMemo(() => documentCostIds(docs, linksByDoc), [docs, linksByDoc]);

  const listLoading = loading || cacheLoading || !storeLoaded;

  const { openCapture } = useCapture();
  // Docs sharing a cost sit next to each other (groupDocumentsByCost); the order is
  // the pairing, so no coloured rail marks it (retired, §3).
  const renderCard = (doc: UnifiedDocument) => (
    <DocumentCard
      key={doc.key}
      doc={doc}
      docLinks={doc.storeId ? (linksByDoc.get(doc.storeId) ?? []) : []}
      costItems={costItems}
      costNames={costNames}
      memberProfiles={memberProfiles}
      reminderTaskId={doc.storeId ? (reminderByDoc[doc.storeId] ?? null) : null}
      onOpenReminder={reminderLinkOn ? (taskId) => router.push(`/tasks?focus=${taskId}`) : null}
      onOpenLink={(link) => router.push(documentLinkHref(link))}
      onToggleTag={toggleTagFilter}
      onMoveToFolder={(storeId) =>
        startMove({ kind: 'document', id: storeId, from: doc.folderId ?? null, name: doc.title || doc.filename })
      }
      onAddToCalendar={calendarOn ? (storeId) => setCalendarDoc({ id: storeId, title: doc.title, filename: doc.filename }) : undefined}
      motion={leavingKey === doc.key ? 'leaving' : 'idle'}
      onChanged={load}
      onDelete={() => dropNow(doc)}
      onSelect={() => startSelect(doc)}
      selecting={selecting}
      selected={selectedKeys.has(doc.key)}
      onToggleSelect={() => toggleSelect(doc)}
      // A tap picks the file: the wide explorer shows it in its preview
      // pane, anywhere narrower in the file sheet. A double-click opens it.
      onActivate={() => setActiveKey(doc.key)}
      active={paneOpen && activeKey === doc.key}
      {...(wide && {
        layout: 'table' as const,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData(DOC_DRAG_TYPE, doc.key);
          e.dataTransfer.effectAllowed = 'move';
        },
      })}
    />
  );

  // ── The wide explorer (Hearth §13.7 "Desktop shell"): folder tree, file
  // table and preview pane. Phones and the classic layout keep the list.
  const activeDoc = activeKey ? (docs.find((d) => d.key === activeKey) ?? null) : null;
  const explorerView: ExplorerView =
    expiryFilter !== 'all' && search.trim() === '' && categoryFilters.size === 0 && tagFilters.length === 0
      ? expiryFilter
      : 'folder';
  const allExpiry = useMemo(() => documentExpiryCounts(docs), [docs]);

  const openInTree = (id: string | null) => {
    clearAllFilters();
    setFolderId(id);
  };
  const showView = (view: 'soon' | 'expired') => {
    clearAllFilters();
    setExpiryFilter(view);
  };

  // A document dragged onto a folder in the tree or the table is filed
  // there, the same as Move to folder.
  const dropDocument = (docKey: string, destination: string | null) => {
    const doc = docs.find((d) => d.key === docKey);
    if (!doc || (doc.folderId ?? null) === destination) return;
    const name = destination ? (folders.find((f) => f.id === destination)?.name ?? 'folder') : 'All documents';
    void fileDocuments([doc], destination, name);
  };

  // Files picked or dropped from the computer go straight into the open
  // folder, filed by kind (quickUploadFields); Edit details refines them.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [fileDragOver, setFileDragOver] = useState(false);
  const uploadFiles = async (files: File[]) => {
    if (!groupId || files.length === 0) return;
    const into = explorerView === 'folder' && !search.trim() ? folderId : null;
    setUploading((n) => n + files.length);
    const supabase = createClient();
    let failed = 0;
    for (const file of files) {
      try {
        await uploadDocument({ supabase, groupId, file, source: 'capture', folderId: into, ...quickUploadFields(file.name, file.type || null) });
      } catch (e) {
        failed += 1;
        toast.error(e instanceof Error ? e.message : "Couldn't add that file");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    const added = files.length - failed;
    if (added > 0) {
      hapticCommit();
      const where = into ? (folders.find((f) => f.id === into)?.name ?? 'the folder') : 'Documents';
      toast.success(added === 1 ? `Added to ${where}` : `Added ${added} files to ${where}`);
    }
    await load();
  };
  const fileDrop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setFileDragOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      setFileDragOver(false);
      if (e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      void uploadFiles([...e.dataTransfer.files]);
    },
  };

  // The column headers sort the table: name A to Z, soonest expiry, newest.
  const sortHeader = (by: typeof sort, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => setSort(by)}
      aria-sort={sort === by ? (by === 'recent' ? 'descending' : 'ascending') : undefined}
      className={cn('flex items-center gap-1 text-left transition-colors hover:text-foreground', sort === by && 'text-foreground', className)}
    >
      {label}
      {sort === by && <ArrowDown className="h-3 w-3" />}
    </button>
  );

  const inspector = (activeDoc: UnifiedDocument) => (
    <DocumentInspector
      key={activeDoc.key}
      doc={activeDoc}
      docLinks={activeDoc.storeId ? (linksByDoc.get(activeDoc.storeId) ?? []) : []}
      costItems={costItems}
      costNames={costNames}
      folders={folders}
      memberProfiles={memberProfiles}
      reminderTaskId={activeDoc.storeId ? (reminderByDoc[activeDoc.storeId] ?? null) : null}
      onOpenReminder={reminderLinkOn ? (taskId) => router.push(`/tasks?focus=${taskId}`) : null}
      onOpenLink={(link) => router.push(documentLinkHref(link))}
      onToggleTag={toggleTagFilter}
      onMoveToFolder={(storeId) => {
        // The file sheet steps aside for the move sheet; the pane stays.
        if (!paneOpen) setActiveKey(null);
        startMove({ kind: 'document', id: storeId, from: activeDoc.folderId ?? null, name: activeDoc.title || activeDoc.filename });
      }}
      onChanged={load}
      onClose={() => setActiveKey(null)}
    />
  );

  const overlays = (
    <>
      {/* Narrower than the explorer's pane, the picked file opens in a sheet. */}
      <BottomSheet open={!paneOpen && !!activeDoc} onOpenChange={(open) => !open && setActiveKey(null)} className="max-h-[88dvh]">
        {activeDoc && inspector(activeDoc)}
      </BottomSheet>
      <FolderMoveSheet
        open={moveOpen}
        onOpenChange={setMoveOpen}
        folders={folders}
        // Moving a folder must not offer its own subtree as a destination.
        movingFolderId={moving?.kind === 'folder' ? moving.id : null}
        currentFolderId={moving?.from ?? null}
        title={moving?.kind === 'folder' ? 'Move folder to' : 'Move document to'}
        itemName={moving?.name ?? null}
        onSelect={handleMoveSelection}
        onCreateAndMove={handleCreateAndMove}
      />

      <FolderMoveSheet
        open={bulkMoveOpen}
        onOpenChange={setBulkMoveOpen}
        folders={folders}
        movingFolderId={null}
        currentFolderId={bulkMove.from}
        title={`Move ${countLabel(bulkMove.count)} to`}
        itemName={null}
        onSelect={moveSelected}
        onCreateAndMove={createAndMoveSelected}
      />

      {calendarOn && <DocumentCalendarFlow doc={calendarDoc} onClose={() => setCalendarDoc(null)} onLinked={() => void load()} />}

      <FolderDeleteSheet
        open={deleteFolderOpen}
        onOpenChange={setDeleteFolderOpen}
        folderName={deleting?.name ?? 'this folder'}
        documentCount={deleting?.count ?? 0}
        onDelete={deleteFolder}
      />

      {selecting && (
        <div
          role="toolbar"
          aria-label="Selected documents"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-popover py-2 pl-4 pr-2 shadow-xl shadow-black/40"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums text-foreground" aria-live="polite">
            {selectedKeys.size === 0 ? 'Tap documents to select' : `${selectedKeys.size} selected`}
          </span>
          <Button size="sm" variant="outline" disabled={selectedKeys.size === 0} onClick={openBulkMove}>
            <FolderInput className="h-3.5 w-3.5" />
            Move
          </Button>
          {/* E4: destructive is danger text, never a fill. */}
          <Button
            size="sm"
            variant="outline"
            disabled={selectedKeys.size === 0}
            onClick={deleteSelected}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          <button
            type="button"
            onClick={exitSelect}
            aria-label="Stop selecting"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );

  // The type filter as one select: every type, the presets first.
  const typeValue =
    categoryFilters.size === 0
      ? ''
      : (PRESETS.find((p) => sameSet(categoryFilters, p.types))?.label ?? (categoryFilters.size === 1 ? [...categoryFilters][0] : 'custom'));
  const pickType = (value: string) => {
    if (!value) return setCategoryFilters(new Set());
    const preset = PRESETS.find((p) => p.label === value);
    setCategoryFilters(new Set(preset ? preset.types : [value as (typeof TYPE_FILTERS)[number]]));
  };
  const crumbs = explorerView === 'folder' && browsing ? folderBreadcrumb(folders, folderId) : [];
  const tableDocs = groupDocumentsByCost(sortedDocs, costIdByKey);
  const filtered = !browsing;
  const heroValue = explorerView === 'folder' && browsing ? ledeDocs.length : sortedDocs.length;
  const heroLabel =
    explorerView === 'soon'
      ? 'expiring soon'
      : explorerView === 'expired'
        ? 'expired'
        : filtered
          ? heroValue === 1 ? 'match' : 'matches'
          : openFolder
            ? `in ${openFolder.name}`
            : heroValue === 1 ? 'file' : 'files';

  const explorer = (
    <div className={cn('mx-auto grid max-w-[1680px] grid-cols-[15.5rem_minmax(0,1fr)] items-start xl:grid-cols-[15.5rem_minmax(0,1fr)_23rem]', selecting && 'pb-28')}>
      <div className="sticky top-0 flex h-[calc(100dvh-4rem)] min-h-0 flex-col border-r border-border/60">
        <FolderTree
          folders={folders}
          documents={docs}
          folderId={browsing ? folderId : null}
          view={explorerView}
          totalCount={docs.length}
          soonCount={allExpiry.soon}
          expiredCount={allExpiry.expired}
          receivingFolderId={receivingFolderId}
          onOpenFolder={openInTree}
          onView={showView}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={renameFolder}
          onMoveFolder={(f) => startMove({ kind: 'folder', id: f.id, from: f.parent_id ?? null, name: f.name })}
          onDeleteFolder={handleDeleteFolder}
          onDropDocument={dropDocument}
        />
      </div>

      <main {...fileDrop} className="relative flex min-h-[calc(100dvh-4rem)] min-w-0 flex-col gap-4 px-7 py-6">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            {crumbs.length > 0 && (
              <nav aria-label="Folder path" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <button type="button" onClick={() => openInTree(null)} className="rounded-md px-0.5 transition-colors hover:text-foreground">
                  All files
                </button>
                {crumbs.map((f, i) => (
                  <span key={f.id} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                    {i === crumbs.length - 1 ? (
                      <span aria-current="location" className="truncate text-foreground">{f.name}</span>
                    ) : (
                      <button type="button" onClick={() => openInTree(f.id)} className="truncate rounded-md px-0.5 transition-colors hover:text-foreground">
                        {f.name}
                      </button>
                    )}
                  </span>
                ))}
              </nav>
            )}
            {!listLoading && (
              <HeroLede
                className="min-w-0"
                value={heroValue}
                label={heroLabel}
                caption={
                  explorerView === 'folder' && (expiryCounts.soon > 0 || expiryCounts.expired > 0) ? (
                    <>
                      {expiryCounts.soon > 0 && <span className="font-medium text-warning">{expiryCounts.soon} expiring soon</span>}
                      {expiryCounts.soon > 0 && expiryCounts.expired > 0 && ' · '}
                      {expiryCounts.expired > 0 && <span className="font-medium text-destructive">{expiryCounts.expired} expired</span>}
                    </>
                  ) : undefined
                }
              />
            )}
          </div>
          {browsing && explorerView === 'folder' && <NewFolderButton onCreate={handleCreateFolder} />}
          <Button className="h-9" disabled={uploading > 0} onClick={() => fileInputRef.current?.click()}>
            {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading > 0 ? `Adding ${uploading}` : 'Add files'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              void uploadFiles(files);
            }}
          />
        </div>

        {/* Filters (H5), directly above the table they scope. */}
        {(listLoading || docs.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            <SectionSearchBar value={search} onChange={setSearch} placeholder="Search all files…" className="w-72 max-w-none" />
            <select
              value={typeValue}
              onChange={(e) => pickType(e.target.value)}
              aria-label="Filter by type"
              className="h-9 shrink-0 rounded-lg border border-input bg-input px-3 text-xs font-medium text-foreground outline-none focus:border-ring"
            >
              <option value="">Any type</option>
              {PRESETS.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
              {TYPE_FILTERS.map((t) => (
                <option key={t} value={t}>{docTypeLabel(t)}</option>
              ))}
              {typeValue === 'custom' && <option value="custom">Several types</option>}
            </select>
            {tagFilters.map((t) => (
              <FilterChip key={t} active onClick={() => toggleTagFilter(t)} aria-label={`Remove tag filter ${t}`}>
                #{t} <X className="h-3 w-3" />
              </FilterChip>
            ))}
            {filtered && (
              <button type="button" onClick={clearAllFilters} className="h-9 px-2 text-xs font-medium text-primary hover:underline">
                Clear
              </button>
            )}
          </div>
        )}

        {listLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tableDocs.length === 0 && childFolders.length === 0 ? (
          docs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description="Keep receipts, warranties, IDs and leases in one place. Drop files here to add them."
              action={{ label: 'Add files', icon: <Plus className="h-4 w-4" />, onClick: () => fileInputRef.current?.click() }}
            />
          ) : filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nothing matches"
              description="Try another search, or clear the filters."
              secondaryAction={{ label: 'Clear filters', onClick: clearAllFilters }}
            />
          ) : (
            <EmptyState
              icon={FolderOpen}
              title="This folder is empty"
              description="Drop files here, or drag a file onto this folder in the list on the left."
            />
          )
        ) : (
          <div>
            <div className="flex h-9 items-center gap-3 px-3 text-xs text-muted-foreground">
              <span className="w-9 shrink-0" />
              {sortHeader('name', 'Name', 'min-w-0 flex-1')}
              <span className={DOC_TABLE_COLUMNS.type}>Type</span>
              {sortHeader('expiry', 'Expires', DOC_TABLE_COLUMNS.expires)}
              {sortHeader('recent', 'Added', DOC_TABLE_COLUMNS.added)}
              <span className={DOC_TABLE_COLUMNS.menu} />
            </div>
            <ListGroup>
              {childFolders.map((f) => (
                <FolderTableRow
                  key={f.id}
                  folder={f}
                  folders={folders}
                  documents={docs}
                  motion={leavingKey === `folder:${f.id}` ? 'leaving' : receivingFolderId === f.id ? 'receiving' : 'idle'}
                  onOpen={() => openInTree(f.id)}
                  onRename={(name) => renameFolder(f.id, name)}
                  onMove={() => startMove({ kind: 'folder', id: f.id, from: f.parent_id ?? null, name: f.name })}
                  onDelete={() => handleDeleteFolder(f.id)}
                  onDropDocument={dropDocument}
                />
              ))}
              {tableDocs.map((d) => renderCard(d))}
            </ListGroup>
            <p className="px-3 pt-3 text-xs text-muted-foreground">
              Drop files here to add them{openFolder && explorerView === 'folder' ? ` to ${openFolder.name}` : ''}. Drag a file onto a folder to move it.
            </p>
          </div>
        )}

        {fileDragOver && (
          <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary/60 bg-background/70 backdrop-blur-sm">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Upload className="h-4 w-4 text-primary" />
              Drop to add {openFolder && explorerView === 'folder' ? `to ${openFolder.name}` : 'to Documents'}
            </p>
          </div>
        )}
      </main>

      <div className="sticky top-0 hidden h-[calc(100dvh-4rem)] min-h-0 flex-col border-l border-border/60 xl:flex">
        {activeDoc ? (
          inspector(activeDoc)
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <MousePointerClick className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Pick a file to preview it</p>
            <p className="text-xs text-muted-foreground">Double-click a file to open it full size.</p>
          </div>
        )}
      </div>

      {overlays}
    </div>
  );

  if (wide) return explorer;

  return (
    // Select mode's bar floats over the foot of the page; the last row must
    // be able to scroll clear of it.
    <div className={cn('mx-auto px-4 py-6', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl', selecting && 'pb-28')}>
      {/* FLUX-187: title removed, the top nav already names this section.
          Inside a folder its path heads the page as micro labels, the way
          back out. Hearth v2 (Pulse, H1): the count is the page's Hero lede,
          held back until the first load lands so it never flashes "0"; New
          folder sits beside it, with the folders it makes (H5). Mirrors
          mobile's grammar. */}
      {browsing && folderId !== null && (
        <div className="mb-1">
          <FolderPath folders={folders} folderId={folderId} onNavigate={(id) => setFolderId(id)} />
        </div>
      )}
      <div className="mb-5 flex items-start justify-between gap-3">
        {!listLoading && (
          <HeroLede
            className="min-w-0"
            value={ledeDocs.length}
            label={openFolder ? `in ${openFolder.name}` : ledeDocs.length === 1 ? 'document' : 'documents'}
            caption={
              expiryCounts.soon > 0 || expiryCounts.expired > 0 ? (
                <>
                  {expiryCounts.soon > 0 && (
                    <span className="font-medium text-warning">{expiryCounts.soon} expiring soon</span>
                  )}
                  {expiryCounts.soon > 0 && expiryCounts.expired > 0 && ' · '}
                  {expiryCounts.expired > 0 && (
                    <span className="font-medium text-destructive">{expiryCounts.expired} expired</span>
                  )}
                </>
              ) : undefined
            }
          />
        )}
        {browsing && (
          <div className="ml-auto flex shrink-0 items-center gap-2 pt-1">
            <NewFolderButton onCreate={handleCreateFolder} />
          </div>
        )}
      </div>

      {/* Filters (H5), inset controls directly above the list they scope.
          With nothing filed yet there is nothing to filter, so they hide (H)
          and the capture button stays the way in. */}
      {(listLoading || docs.length > 0) && (
        <div className="mb-2 space-y-2">
          <SectionSearchBar value={search} onChange={setSearch} placeholder="Search documents…" className="max-w-none" />
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={EXPIRY_OPTIONS}
              value={expiryFilter}
              onChange={setExpiryFilter}
              size="sm"
              ariaLabel="Filter by expiry"
              className={cn(CONTROL_H, 'flex-1 sm:flex-none')}
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              aria-label="Sort documents"
              className={cn(
                CONTROL_H,
                'shrink-0 rounded-lg border border-input bg-input px-3 text-xs font-medium text-foreground outline-none focus:border-ring'
              )}
            >
              <option value="recent">Newest</option>
              <option value="expiry">Soonest expiry</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>

          {/* Quick presets (FLUX-135), then every type behind "More types". */}
          <div className="flex flex-wrap items-center gap-x-1.5">
            {PRESETS.map((p) => {
              const active = sameSet(categoryFilters, p.types);
              return (
                <FilterChip
                  key={p.label}
                  active={active}
                  onClick={() => setCategoryFilters(active ? new Set() : new Set(p.types))}
                >
                  {p.label}
                </FilterChip>
              );
            })}
            <FilterChip
              active={false}
              onClick={() => setTypesExpanded(!typesOpen)}
              aria-pressed={undefined}
              aria-expanded={typesOpen}
            >
              More types
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', typesOpen && 'rotate-180')} />
            </FilterChip>
            {(categoryFilters.size > 0 || tagFilters.length > 0) && (
              <button
                type="button"
                onClick={() => { setCategoryFilters(new Set()); setTagFilters([]); }}
                className="min-h-11 px-2 text-xs font-medium text-primary hover:underline sm:min-h-9"
              >
                Clear
              </button>
            )}
          </div>

          {typesOpen && (
            <div className="flex flex-wrap gap-x-1.5" aria-label="Document types">
              {TYPE_FILTERS.map((t) => (
                <FilterChip key={t} active={categoryFilters.has(t)} onClick={() => toggleCategory(t)}>
                  {docTypeLabel(t)}
                </FilterChip>
              ))}
            </div>
          )}

          {/* Active tag filters: filled like any active chip, tap to drop. */}
          {tagFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-1.5">
              {tagFilters.map((t) => (
                <FilterChip key={t} active onClick={() => toggleTagFilter(t)} aria-label={`Remove tag filter ${t}`}>
                  #{t} <X className="h-3 w-3" />
                </FilterChip>
              ))}
            </div>
          )}
        </div>
      )}

      {listLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : sortedDocs.length === 0 && childFolders.length === 0 ? (
        // Hearth §11 empty states: centered on the ground, one headline, one
        // line, at most one action.
        docs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Keep receipts, warranties, IDs and leases in one place."
            action={{ label: 'Add a document', icon: <Plus className="h-4 w-4" />, onClick: openCapture }}
          />
        ) : !browsing ? (
          <EmptyState
            icon={SearchX}
            title="Nothing matches"
            description="Try another search, or clear the filters."
            secondaryAction={{ label: 'Clear filters', onClick: clearAllFilters }}
          />
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="This folder is empty"
            description="File a document here with Move to folder in its menu."
          />
        )
      ) : (
        <div className="space-y-7 pt-4">
          {/* Folders and files each get their own labelled section, so a
              folder never reads as one more row: folders lead as a grid of
              tiles (a container before its contents), documents follow as
              line items in one card per section. */}
          {childFolders.length > 0 && (
            <section>
              <DocumentsSectionLabel label="Folders" count={childFolders.length} />
              {/* Folders as rows, one card above the files (the phone's grammar). */}
              <ListGroup>
                {childFolders.map((f) => (
                  <FolderTableRow
                    key={f.id}
                    layout="list"
                    folder={f}
                    folders={folders}
                    documents={docs}
                    motion={leavingKey === `folder:${f.id}` ? 'leaving' : receivingFolderId === f.id ? 'receiving' : 'idle'}
                    onOpen={() => setFolderId(f.id)}
                    onRename={(name) => renameFolder(f.id, name)}
                    onMove={() => startMove({ kind: 'folder', id: f.id, from: f.parent_id ?? null, name: f.name })}
                    onDelete={() => handleDeleteFolder(f.id)}
                    onDropDocument={dropDocument}
                  />
                ))}
              </ListGroup>
            </section>
          )}
          {/* Group headers are micro labels with a count (§6). The rows
              already tint their own expiry word, so the header stays muted
              (H2). */}
          {/* Hearth §13.7 "Desktop shell": on a wide screen the sections sit
              side by side as columns. */}
          <div className={cn(wide ? 'grid grid-cols-2 items-start gap-6 xl:grid-cols-3' : 'space-y-7')}>
            {sections.map((section) => (
              <section key={section.key}>
                <DocumentsSectionLabel label={section.label} count={section.docs.length} />
                <ListGroup>{groupDocumentsByCost(section.docs, costIdByKey).map((d) => renderCard(d))}</ListGroup>
              </section>
            ))}
          </div>
        </div>
      )}

      {overlays}
    </div>
  );
}
