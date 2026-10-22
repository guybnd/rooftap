'use client';

// FLUX-105 + FLUX-106: the documents store browse view, now showing a UNIFIED
// list — store documents (full controls: open, rename, delete, link management)
// plus legacy files (cost_documents / warranty_files / grocery receipts) surfaced
// read-only via read-merge, deduped by storage path. So every file in the group
// is visible here regardless of which surface uploaded it.

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { useDataCache } from '@/lib/data-cache';
import { useGroupTableRefetch } from '@/lib/hooks/use-group-table-realtime';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useWideLayout } from '@/lib/desktop-layout';
import { use$ } from '@legendapp/state/react';
import {
  listUnifiedDocuments,
  listLinksForGroup,
  deleteDocument,
  deleteLegacyDocument,
  adoptLegacyDocument,
  signedDocumentUrl,
  docTypeLabel,
  SIGNED_URL_TTL_SECONDS,
  type UnifiedDocument,
} from '@/lib/documents';
import { PopMenu, MenuItem, MenuDivider } from '@/app/setup/pop-menu';
import { useRowContextMenu, withRowMenu } from '@/components/ui/row-context-menu';
import {
  reminderKey,
  parseReminderKey,
  createManualReminder,
  syncDocumentReminder,
  deleteDocumentReminder,
} from '@homeup/core';
import { dialog } from '@homeup/core';
import { memberLabel } from '@/app/setup/member-label';
import {
  DocumentsSectionLabel,
  FolderPath,
  FolderTile,
  NewFolderButton,
  ROW_LEAVE_MS,
  rowMotionClass,
  type RowMotion,
} from '@/components/documents/folder-browser';
import { stopRow, useRowLongPress } from '@/components/documents/use-row-long-press';
import { EmptyState } from '@/components/ui/empty-state';
import { useCapture } from '@/components/capture/capture-context';
import { commit as hapticCommit, warn as hapticWarn } from '@/lib/haptics';
import { FolderMoveSheet } from '@/components/documents/folder-move-sheet';
import { DocumentCalendarFlow, type CalendarDoc } from '@/components/documents/document-calendar-flow';
import { FolderDeleteSheet } from '@/components/documents/folder-delete-sheet';
import { Button } from '@/components/ui/button';
import {
  listDocumentFolders,
  createDocumentFolder,
  draftDocumentFolder,
  renameDocumentFolder,
  moveDocumentFolder,
  deleteDocumentFolder,
  foldersInParent,
  documentsInFolder,
  folderDescendantIds,
  documentExpiryCounts,
  documentListSections,
  type DocumentFolder,
} from '@homeup/core';
import { metadataSummary, documents$, useStoreHelpers, useReconnectSync, useStoreLoaded, compareStrings, useModules, visibleDocumentLinks, serviceLabel, documentLinkHref } from '@homeup/core';
import { timeAgo } from '@homeup/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { listCostItems } from '@homeup/core';
import {
  ListItem,
  ListGroup,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
} from '@/components/ui/list-item';
import { PortalChipRow, type PortalChipDef } from '@/components/ui/portal-chip';
import { HeroLede } from '@/components/ui/hero-lede';
import { DocumentPreview } from '@/components/documents/document-preview';
import { DocumentEditModal } from '@/components/documents/document-edit-modal';
import { SectionSearchBar } from '@/components/section-search-bar';
import { SegmentedControl, type SegmentOption } from '@/components/ui/segmented-control';
import { useFuzzySearch } from '@/hooks/use-fuzzy-search';
import type { Document, DocumentLink, DocType, DocumentSource, CostItem } from '@homeup/core';
import {
  BookOpen, CalendarClock, CalendarPlus, Car, Check, ChevronDown, Eye, FileText, FolderInput, FolderOpen, HeartPulse, IdCard, Image as ImageIcon,
  Key, Landmark, ListChecks, Loader2, MoreHorizontal, Pencil, Plus, Receipt, SearchX, Share2, Shield, ShieldCheck, Signature, Trash2, Wrench, X,
  type LucideIcon,
} from 'lucide-react';

const SOURCE_LABEL: Record<DocumentSource, string> = {
  capture: 'Capture', cost: 'Costs', warranty: 'Warranties', grocery: 'Groceries', other: 'Other',
};
const TYPE_FILTERS: DocType[] = [
  'invoice', 'receipt', 'warranty', 'manual', 'contract', 'photo',
  'id_personal', 'insurance', 'lease_contract', 'tax_financial', 'medical', 'vehicle', 'appliance_manual', 'other',
];

// "Expiring soon" window for the grouped section (FLUX-118).
const SOON_DAYS = 30;

// Quick-filter presets (FLUX-135): one tap selects a category set.
const PRESETS: { label: string; types: DocType[] }[] = [
  { label: 'Warranties', types: ['warranty', 'appliance_manual'] },
  { label: 'Insurance', types: ['insurance'] },
  { label: 'Vehicle', types: ['vehicle'] },
  { label: 'Leases', types: ['lease_contract'] },
  { label: 'IDs', types: ['id_personal'] },
  { label: 'Receipts', types: ['receipt', 'invoice'] },
];

const sameSet = (a: Set<DocType>, b: DocType[]) =>
  a.size === b.length && b.every((t) => a.has(t));

/** Whole days until a doc's expiry (negative = expired), or null when no expiry. */
function expiryDaysOf(d: UnifiedDocument): number | null {
  return d.expiryDate ? Math.ceil((new Date(d.expiryDate).getTime() - Date.now()) / 86_400_000) : null;
}

/**
 * The row's expiry fragment (H6: relative when near, a short date when far,
 * never raw ISO). Only expired and soon take a status hue, as a word (H2).
 * Mirrors mobile's document-row.tsx.
 */
function expiryLabel(days: number, expiryDate: string): { text: string; className?: string } {
  const date = new Date(`${expiryDate.slice(0, 10)}T00:00:00`);
  if (days < 0) {
    const ago = -days;
    return {
      text: ago <= SOON_DAYS
        ? `expired ${ago}d ago`
        : `expired ${date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
      className: 'text-destructive',
    };
  }
  if (days === 0) return { text: 'expires today', className: 'text-warning' };
  if (days === 1) return { text: 'expires tomorrow', className: 'text-warning' };
  if (days <= SOON_DAYS) return { text: `expires in ${days}d`, className: 'text-warning' };
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return {
    text: `expires ${date.toLocaleDateString(
      'en-US',
      sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }
    )}`,
  };
}

/** Metadata values read as words: an ISO date becomes a short date (H6). */
function metadataValue(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Hearth §6 Document row: the leading chip is the doc type, a glyph on a
// neutral inset tile. Type is identity, not state, so it takes no hue (H2).
// Same glyphs as mobile's document-row.tsx.
const DOC_TYPE_GLYPH: Record<string, LucideIcon> = {
  invoice: FileText,
  receipt: Receipt,
  warranty: ShieldCheck,
  manual: BookOpen,
  contract: Signature,
  photo: ImageIcon,
  id_personal: IdCard,
  insurance: Shield,
  lease_contract: Key,
  tax_financial: Landmark,
  medical: HeartPulse,
  vehicle: Car,
  appliance_manual: Wrench,
  bill: Receipt,
  other: FileText,
};

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

  const [categoryFilters, setCategoryFilters] = useState<Set<DocType>>(new Set());
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'soon' | 'expired'>('all');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<'recent' | 'expiry' | 'name'>('recent');
  const [search, setSearch] = useState('');
  // The fourteen type chips fold behind "More types" (H: chrome shrinks);
  // they stay open while a type outside the presets is the active filter.
  const [typesExpanded, setTypesExpanded] = useState(false);
  const presetActive = PRESETS.some((p) => sameSet(categoryFilters, p.types));
  const typesOpen = typesExpanded || (categoryFilters.size > 0 && !presetActive);

  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  // The open folder lives in the URL, so browser and Android back climb out
  // one folder at a time instead of leaving the section, and a folder can be
  // linked. An id that isn't a folder (deleted, another group's) reads as
  // the top level once folders have loaded.
  const searchParams = useSearchParams();
  const folderParam = searchParams.get('folder');
  const folderId =
    folderParam && (loading || folders.some((f) => f.id === folderParam)) ? folderParam : null;
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // What the bulk move sheet is filing, read when it opens so its title holds
  // while it dismisses (the selection clears the moment a folder is picked).
  const [bulkMove, setBulkMove] = useState<{ count: number; from: string | null | undefined }>({ count: 0, from: undefined });
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  // The folder the delete sheet is about, read when it opens and kept while
  // the sheet dismisses, by which time the folder is gone.
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const [deleteFolderOpen, setDeleteFolderOpen] = useState(false);

  const toggleCategory = (c: DocType) =>
    setCategoryFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  const toggleTagFilter = (t: string) =>
    setTagFilters((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

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
    const map: Record<string, string> = {};
    for (const r of (reminders.data ?? []) as Array<{ id: string; template_key: string | null }>) {
      const parsed = parseReminderKey(r.template_key);
      if (parsed?.kind === 'document') map[parsed.originId] = r.id;
    }
    setReminderByDoc(map);
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

  // Browsing means "no query, no filters": folders only structure the plain
  // list. A search or filter looks across the whole tree instead, because
  // finding nothing merely for standing in the wrong folder is worse than a
  // flat result that spans folders.
  const browsing =
    search.trim() === '' && categoryFilters.size === 0 && tagFilters.length === 0 && expiryFilter === 'all';
  const childFolders = browsing ? foldersInParent(folders, folderId) : [];

  // Legacy documents have no folder_id, so they always read as root.
  const scoped = browsing ? documentsInFolder(docs, folderId) : docs;

  const filtered = scoped.filter((d) => {
    if (categoryFilters.size > 0 && !categoryFilters.has(d.docType as DocType)) return false;
    if (tagFilters.length > 0 && !tagFilters.every((t) => d.tags.includes(t))) return false;
    if (expiryFilter !== 'all') {
      const days = expiryDaysOf(d);
      if (days == null) return false;
      if (expiryFilter === 'expired' && days >= 0) return false;
      if (expiryFilter === 'soon' && (days < 0 || days > SOON_DAYS)) return false;
    }
    return true;
  });

  // Fuzzy search narrows the already-filtered set (FLUX-110).
  const searchedDocs = useFuzzySearch(filtered, search, ['filename', 'title']);

  // Sort, then split out an "expiring soon" group (only in the unfiltered expiry view).
  const sortedDocs = useMemo(() => {
    const arr = [...searchedDocs];
    if (sort === 'name') {
      arr.sort((a, b) => compareStrings(a.title || a.filename, b.title || b.filename));
    } else if (sort === 'expiry') {
      arr.sort((a, b) => {
        const da = expiryDaysOf(a), db = expiryDaysOf(b);
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      });
    } // 'recent' keeps listUnifiedDocuments' newest-first order
    return arr;
  }, [searchedDocs, sort]);

  // Labelled sections under the folders ("Expiring soon", then "Files"),
  // split the same way on mobile. No soon section while the list is already
  // filtered or sorted by expiry, where it would only repeat the list.
  const showSoonGroup = expiryFilter === 'all' && sort !== 'expiry';
  const sections = useMemo(() => documentListSections(sortedDocs, showSoonGroup), [sortedDocs, showSoonGroup]);

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
  const linksByDoc = useMemo(() => {
    const m = new Map<string, DocumentLink[]>();
    for (const l of visibleDocumentLinks(links, modules.feature)) {
      const arr = m.get(l.document_id) ?? [];
      arr.push(l);
      m.set(l.document_id, arr);
    }
    return m;
  }, [links, modules]);

  // FLUX-135: map each doc → its (first) linked cost, for paired-by-cost display.
  const costIdByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of docs) {
      const dl = d.storeId ? (linksByDoc.get(d.storeId) ?? []) : [];
      const cost = dl.find((l) => l.entity_type === 'cost_item');
      if (cost) m[d.key] = cost.entity_id;
    }
    return m;
  }, [docs, linksByDoc]);

  // Reorder a list so docs sharing a cost are adjacent.
  const groupByCost = (list: UnifiedDocument[]) => {
    const counts: Record<string, number> = {};
    for (const d of list) { const c = costIdByKey[d.key]; if (c) counts[c] = (counts[c] ?? 0) + 1; }
    const ordered: UnifiedDocument[] = [];
    const placed = new Set<string>();
    for (const d of list) {
      if (placed.has(d.key)) continue;
      ordered.push(d); placed.add(d.key);
      const c = costIdByKey[d.key];
      if (c && counts[c] > 1) {
        for (const o of list) {
          if (!placed.has(o.key) && costIdByKey[o.key] === c) { ordered.push(o); placed.add(o.key); }
        }
      }
    }
    return { ordered };
  };

  const listLoading = loading || cacheLoading || !storeLoaded;

  // The Hero lede counts what the surface holds: every document at the top
  // level (and while a search spans the tree), the open folder's whole
  // subtree inside one. Its caption is that set's expiry state. Mirrors
  // mobile's documents/index.tsx.
  const openFolder = browsing && folderId !== null ? (folders.find((f) => f.id === folderId) ?? null) : null;
  const ledeDocs = useMemo(() => {
    if (!openFolder) return docs;
    const subtree = folderDescendantIds(folders, openFolder.id);
    subtree.add(openFolder.id);
    return docs.filter((d) => d.folderId != null && subtree.has(d.folderId));
  }, [docs, folders, openFolder]);
  const expiryCounts = useMemo(() => documentExpiryCounts(ledeDocs), [ledeDocs]);

  const { openCapture } = useCapture();
  const clearAllFilters = () => {
    setSearch('');
    setCategoryFilters(new Set());
    setTagFilters([]);
    setExpiryFilter('all');
  };

  // Docs sharing a cost sit next to each other (groupByCost); the order is
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
    />
  );

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
              <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', wide && 'lg:grid-cols-4 xl:grid-cols-6')}>
                {childFolders.map((f) => (
                  <FolderTile
                    key={f.id}
                    folder={f}
                    folders={folders}
                    documents={docs}
                    onOpen={() => setFolderId(f.id)}
                    onRename={(name) => renameFolder(f.id, name)}
                    onMove={() => startMove({ kind: 'folder', id: f.id, from: f.parent_id ?? null, name: f.name })}
                    onDelete={() => handleDeleteFolder(f.id)}
                    motion={
                      leavingKey === `folder:${f.id}` ? 'leaving' : receivingFolderId === f.id ? 'receiving' : 'idle'
                    }
                  />
                ))}
              </div>
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
                <ListGroup>{groupByCost(section.docs).ordered.map((d) => renderCard(d))}</ListGroup>
              </section>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}

function DocumentCard({
  doc, docLinks, costItems, costNames, memberProfiles, reminderTaskId, onOpenReminder, onOpenLink, onToggleTag, onMoveToFolder, onAddToCalendar, onChanged, onDelete, motion,
  onSelect, selecting, selected, onToggleSelect,
}: {
  doc: UnifiedDocument;
  docLinks: DocumentLink[];
  costItems: CostItem[];
  costNames: Record<string, string>;
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  reminderTaskId: string | null;
  /** Null when the reminder's task can't be opened (Tasks off). */
  onOpenReminder: ((taskId: string) => void) | null;
  onOpenLink: (link: Pick<DocumentLink, 'entity_type' | 'entity_id'>) => void;
  onToggleTag: (tag: string) => void;
  /** Called with the store id, after adopting a legacy file if it needed one. */
  onMoveToFolder: (storeId: string) => void;
  /** Documents' "Add to calendar" (calendar.event-documents); undefined hides it. Called with the store id. */
  onAddToCalendar?: (storeId: string) => void;
  onChanged: () => Promise<void> | void;
  /** Takes the document off the list now and deletes it behind that. */
  onDelete: () => void;
  motion: RowMotion;
  /** Starts select mode with this document ticked. */
  onSelect: () => void;
  /** Select mode: a tap or a hold ticks the row instead of opening it. */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);

  const longPress = useRowLongPress(() => (selecting ? onToggleSelect() : setHoldMenuOpen(true)));
  // Hearth §13.7 "Row menu": right-click with a mouse (outside select mode).
  const rowMenu = useRowContextMenu(() =>
    selecting
      ? null
      : {
          title: doc.title || doc.filename,
          kind: 'Document',
          actions: [
            { id: 'preview', label: 'Preview', group: 'open', icon: 'open', run: () => setPreviewing(true) },
            !!reminderTaskId && !!onOpenReminder && { id: 'reminder', label: 'Open reminder', group: 'open', icon: 'due', run: () => onOpenReminder(reminderTaskId) },
            !reminderTaskId && { id: 'remind', label: 'Set reminder', group: 'set', icon: 'due', run: () => void createReminder() },
            { id: 'move', label: 'Move to folder', group: 'set', icon: 'move', run: () => void ensureStored().then((id) => id && onMoveToFolder(id)) },
            !!onAddToCalendar && { id: 'calendar', label: 'Add to calendar', group: 'set', icon: 'calendar', run: () => void ensureStored().then((id) => id && onAddToCalendar(id)) },
            { id: 'share', label: 'Share', group: 'share', icon: 'share', run: () => void share() },
            { id: 'select', label: 'Select', group: 'edit', icon: 'select', run: onSelect },
            { id: 'edit', label: 'Edit details', group: 'edit', icon: 'edit', run: () => void ensureStored().then((id) => id && setEditing(true)) },
            {
              id: 'delete',
              label: 'Delete',
              group: 'danger',
              icon: 'delete',
              danger: true,
              disabled: busy,
              run: () => (doc.storeId ? void remove() : void removeLegacy()),
            },
          ],
        }
  );

  // Meta (FLUX-125, Hearth §6 Document row): type, then one fact. A
  // document with an expiry shows when it expires (warn < 30d), since that
  // is what it is filed for; otherwise how long ago it was added.
  const expiryDays = expiryDaysOf(doc);
  const expiry = expiryDays != null && doc.expiryDate ? expiryLabel(expiryDays, doc.expiryDate) : null;
  const added = timeAgo(doc.createdAt);
  const TypeGlyph = DOC_TYPE_GLYPH[doc.docType] ?? FileText;
  const metaFields = metadataSummary(doc.docType, doc.metadata);
  // Footer: who filed it, and where it came from when that isn't a capture
  // here. A legacy file names the bill or receipt it belongs to, as plain
  // text: it has no portal to open (PC1).
  const origin = doc.impliedEntity
    ? serviceLabel(doc.impliedEntity.type, doc.impliedEntity.id, costNames)
    : doc.source !== 'capture' && doc.source !== 'other'
      ? SOURCE_LABEL[doc.source]
      : null;
  const footer = [doc.uploadedBy ? memberLabel(doc.uploadedBy, memberProfiles) : null, origin]
    .filter(Boolean)
    .join(' · ');

  const remove = async () => {
    if (!doc.storeId) return;
    const confirmed = await dialog.confirm({
      title: `Delete "${doc.title || doc.filename}"?`,
      message: 'This removes it from the store.',
      destructive: true,
    });
    if (!confirmed) return;
    onDelete();
  };

  // Legacy files (bill attachments, grocery receipts) have no store row to
  // edit, file or remind on. The first such action adopts the file into the
  // store, which the old Adopt button did as a separate step, and seeds the
  // store with the new row so the action lands on it at once.
  const { seedRow } = useStoreHelpers(documents$(doc.groupId), null);
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const storeId = doc.storeId ?? adoptedId;
  const ensureStored = async (): Promise<string | null> => {
    if (storeId) return storeId;
    setBusy(true);
    try {
      const row = await adoptLegacyDocument(createClient(), doc);
      seedRow(row);
      setAdoptedId(row.id);
      return row.id;
    } catch (e) {
      console.error('Adopting a legacy file failed:', e);
      toast.error("Couldn't open that file for editing");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const removeLegacy = async () => {
    const confirmed = await dialog.confirm({
      title: `Delete "${doc.title || doc.filename}"?`,
      message: `This removes the file from ${SOURCE_LABEL[doc.source] ?? 'its source'}.`,
      destructive: true,
    });
    if (!confirmed) return;
    onDelete();
  };

  // FLUX-234: Web Share API when available (with the file itself, so the OS
  // share sheet can hand it to another app), falling back to sharing just the
  // signed link, then to opening it in a new tab if navigator.share is absent.
  const share = async () => {
    const url = await signedDocumentUrl(createClient(), doc.storagePath, SIGNED_URL_TTL_SECONDS, doc.bucket);
    if (!url) return;
    const label = doc.title || doc.filename;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], doc.filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: label });
        return;
      }
    } catch (err) {
      // A deliberate cancel of the file-share sheet should not re-pop a second
      // (link-based) share sheet — only genuine failures fall through below.
      if (err instanceof Error && err.name === 'AbortError') return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ url, title: label });
        return;
      } catch {
        // user cancelled or share failed — fall back to opening the file
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const createReminder = async () => {
    const id = await ensureStored();
    if (!id) return;
    const supabase = createClient();
    const name = doc.title || doc.filename;
    if (doc.expiryDate) {
      await syncDocumentReminder(supabase, { id, groupId: doc.groupId, name, expiryDate: doc.expiryDate });
    } else {
      await createManualReminder(supabase, {
        groupId: doc.groupId, templateKey: reminderKey('document', id, 'expiry'), title: `Renew ${name}`,
      });
    }
    await onChanged();
  };

  // FLUX-271 (Hearth §6 portal contract): tags, reminder, and cost-item links
  // consolidated into ONE PortalChipRow instead of three hand-rolled chip
  // rows. Order: tags, then reminder (if set), then cost links. Only store
  // docs have portals — legacy docs render their own minimal static line
  // below instead (they have nothing to filter/open).
  const portalChips: PortalChipDef[] = doc.storeId
    ? [
        ...doc.tags.map((t) => ({
          key: `tag-${t}`,
          label: `#${t}`,
          tone: 'neutral' as const,
          onOpen: () => onToggleTag(t),
        })),
        ...(reminderTaskId && onOpenReminder
          ? [{
              key: 'reminder',
              icon: <CalendarClock className="h-3 w-3" />,
              label: 'Reminder',
              // PC5 (FLUX-1554): navigates away to /tasks — leaves the section.
              tone: 'accent' as const,
              onOpen: () => onOpenReminder(reminderTaskId),
            }]
          : []),
        ...docLinks.map((link) => ({
          key: `link-${link.id}`,
          label: serviceLabel(link.entity_type, link.entity_id, costNames),
          // PC5 (FLUX-1554): navigates away to the linked item's section (or recipe).
          tone: 'accent' as const,
          onOpen: () => onOpenLink(link),
        })),
      ]
    : [];

  return (
    <ListItem
      className={cn(
        'items-start px-3.5 py-3 cursor-pointer select-none [-webkit-touch-callout:none]',
        rowMotionClass(motion)
      )}
      // M3: tapping the row opens the file. Clicks from the portalled menu
      // and sheets bubble here through React's tree, so only a click that
      // landed on the row itself counts.
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (selecting) onToggleSelect();
        else setPreviewing(true);
      }}
      aria-selected={selecting ? selected : undefined}
      // Legacy files get the same hold-to-edit menu; ensureStored adopts one
      // the first time an action needs a store row.
      holdProgress={longPress.progress}
      {...withRowMenu(longPress.handlers, rowMenu)}
    >
      {rowMenu.menu}
      <ListItemLeading>
        {/* Select mode swaps the type glyph for its tick, same place and
            size as Costs' select mode. */}
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {selecting ? (
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border-2',
                selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
              )}
            >
              {selected && <Check className="h-3 w-3" />}
            </span>
          ) : (
            <TypeGlyph />
          )}
        </span>
      </ListItemLeading>
      <ListItemContent className="gap-0.5">
        {/* The keyboard path to the preview (a pointer taps the row). Not a
            <button>: a hold that starts on the title must still open the
            menu, and NO_HOLD skips buttons. */}
        <span
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (selecting) onToggleSelect();
              else setPreviewing(true);
            }
          }}
          className="block min-w-0 w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ListItemTitle>{doc.title || doc.filename}</ListItemTitle>
        </span>
        {/* Meta grammar (§6 Document row, H6): type, one dot, one fact.
            HOUP-253: no flex-nowrap, so a long fragment wraps on a phone. */}
        <ListItemMeta>
          <span>
            {docTypeLabel(doc.docType)}
            {' · '}
            {expiry ? (
              <span className={expiry.className}>{expiry.text}</span>
            ) : (
              (added ? added.replace(/^Just now$/, 'just now') : 'just now')
            )}
          </span>
        </ListItemMeta>

        {/* Per-category sub-fields, read-only (FLUX-133), as one quiet line. */}
        {metaFields.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {metaFields.map((f) => `${f.label} ${metadataValue(f.value)}`).join(', ')}
          </p>
        )}

        {/* Portal line (FLUX-271, Hearth §6 PC): tags filter in place, the
            reminder and cost links leave the section. Legacy files have no
            portals; what they belong to reads in the footer instead. */}
        {!selecting && doc.storeId && portalChips.length > 0 && (
          // FLUX-1554: no fixed overflowTitle — the overflow can mix tags
          // and links, so the component's default "More" fits both.
          <PortalChipRow chips={portalChips} className="mt-1" />
        )}

        {footer && <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{footer}</p>}
      </ListItemContent>

      {!selecting && (
      <ListItemTrailing {...stopRow}>
        {/* FLUX-234: hold anywhere on the row opens this same menu as a bottom
            sheet (see longPress above); the trigger covers non-touch users. */}
          <PopMenu
            align="right"
            triggerClassName="-mr-1.5 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            triggerLabel="More actions"
            trigger={<MoreHorizontal className="h-4 w-4" />}
            open={holdMenuOpen}
            onOpenChange={setHoldMenuOpen}
            mobileSheet
            previewContent={
              <>
                <TypeGlyph className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {doc.title || doc.filename}
                </span>
              </>
            }
          >
            {(close) => (
              <>
                {/* FLUX-271: the in-row "+ Link" add-button was retired (Hearth: add
                    buttons belong to the editor) — linking to a cost item now lives in
                    this edit sheet's "Linked costs" field. */}
                <MenuItem icon={<ListChecks className="h-3.5 w-3.5" />} onClick={() => { close(); onSelect(); }}>
                  Select
                </MenuItem>
                <MenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    void ensureStored().then((id) => id && setEditing(true));
                  }}
                >
                  Edit details
                </MenuItem>
                {/* FLUX-271: the in-row "+ Reminder" add-button was retired — creating a
                    reminder for a doc without one lives here instead (a reminder tied
                    to an expiry date is created/kept in sync from the edit sheet). */}
                {!reminderTaskId && (
                  <MenuItem icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => { close(); void createReminder(); }}>
                    Set reminder
                  </MenuItem>
                )}
                <MenuItem
                  icon={<FolderInput className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    void ensureStored().then((id) => id && onMoveToFolder(id));
                  }}
                >
                  Move to folder
                </MenuItem>
                {onAddToCalendar && (
                  <MenuItem
                    icon={<CalendarPlus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      close();
                      void ensureStored().then((id) => id && onAddToCalendar(id));
                    }}
                  >
                    Add to calendar
                  </MenuItem>
                )}
                <MenuItem icon={<Share2 className="h-3.5 w-3.5" />} onClick={() => { close(); void share(); }}>
                  Share
                </MenuItem>
                {/* The row's own tap previews; this is its name in the menu,
                    where the retired trailing preview icon used to be. */}
                <MenuItem icon={<Eye className="h-3.5 w-3.5" />} onClick={() => { close(); setPreviewing(true); }}>
                  Preview
                </MenuItem>
                <MenuDivider />
                <MenuItem danger disabled={busy} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); if (doc.storeId) remove(); else removeLegacy(); }}>
                  Delete
                </MenuItem>
              </>
            )}
          </PopMenu>
      </ListItemTrailing>
      )}

      {/* The preview portals to the body, but React still bubbles its
          events through this row: its clicks (the backdrop's close among
          them) must not reach the row and reopen it, nor start a hold. */}
      {previewing && (
        <div className="contents" {...stopRow}>
          <DocumentPreview
            filename={doc.filename}
            storagePath={doc.storagePath}
            bucket={doc.bucket}
            label={doc.title}
            onClose={() => setPreviewing(false)}
          />
        </div>
      )}
      {editing && storeId && (
        <DocumentEditModal
          doc={{ ...doc, storeId, legacy: false }}
          docLinks={docLinks}
          costItems={costItems}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
    </ListItem>
  );
}
