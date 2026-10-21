// HOUP-83: native Documents — offline-first list, capture, preview, edit.
// Mirrors apps/web/src/app/documents/page.tsx's data path (documents$ +
// listUnifiedDocuments read-merge) and filter/preset/grouping logic (reused
// from @homeup/core's TYPE_FILTERS/SOON_DAYS/PRESETS/expiryDaysOf, moved
// there in this same ticket). Faithful-but-focused per the approved plan:
// capture now also routes Invoice→Costs and Grocery Bill→Groceries, plus
// multi-file batch upload (HOUP-94), on top of the original Document/Photo/
// Other flow.
//
// HOUP-230: cost-link editing now lives in DocumentEditSheet (staged +
// diffed on save, same shape as web); search uses the shared
// `useFuzzySearch` (promoted to packages/core in HOUP-121 — no longer
// web-only); and `document_links` changes now trigger a debounced refetch via
// `use-group-table-realtime.ts` (apps/mobile's first realtime-refetch hook,
// mirroring apps/web/src/lib/hooks/use-group-table-realtime.ts :212).
import * as React from 'react';
import { ActivityIndicator, Alert, BackHandler, LayoutAnimation, Pressable, Share as RNShare, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { use$ } from '@legendapp/state/react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { Check, ChevronDown, FileText, FolderInput, FolderOpen, Plus, SearchX, Trash2, X } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  Button,
  EmptyState,
  HeroLede,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemTitle,
  ListItemTrailing,
  ScreenBackground,
  SectionSearchBar,
  SegmentedControl,
  cn,
  haptics,
  toast,
  type RowPos,
} from '@homeup/ui';
import {
  DocumentsSectionLabel,
  FolderDeleteSheet,
  FolderNameSheet,
  FolderMoveSheet,
  FolderPath,
  FolderTile,
  MoveMotion,
  NewFolderButton,
  ROW_LEAVE_MS,
} from '@/components/documents/folder-ui';
import {
  adoptLegacyDocument,
  createManualReminder,
  deleteDocument,
  deleteDocumentReminder,
  deleteLegacyDocument,
  documents$,
  useStoreHelpers,
  docTypeLabel,
  listCostItems,
  listDocumentTags,
  listLinksForGroup,
  listUnifiedDocuments,
  listDocumentFolders,
  createDocumentFolder,
  draftDocumentFolder,
  renameDocumentFolder,
  moveDocumentFolder,
  deleteDocumentFolder,
  foldersInParent,
  folderDescendantIds,
  documentsInFolder,
  documentExpiryCounts,
  documentListSections,
  isFilable,
  type DocumentFolder,
  PRESETS,
  reminderKey,
  sameSet,
  signedDocumentUrl,
  SIGNED_URL_TTL_SECONDS,
  SOON_DAYS,
  syncDocumentReminder,
  TYPE_FILTERS,
  expiryDaysOf,
  useReconnectSync,
  useStoreLoaded,
  compareStrings,
  useModules,
  visibleDocumentLinks,
  documentLinkHref,
  type CostItem,
  type Document,
  type DocumentLink,
  type DocType,
  type UnifiedDocument,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { NoGroupScreen } from '@/components/no-group-screen';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { useGroupTableRefetch } from '@/lib/use-group-table-realtime';
// HOUP-121: not re-exported from the main `@homeup/core` barrel — it pulls in
// React client hooks that break the barrel's server-side (route handler)
// consumers — imported by direct path, same convention as apps/web/src/hooks/use-fuzzy-search.ts.
import { useFuzzySearch } from '@homeup/core/src/hooks/use-fuzzy-search';
import { DocumentRow } from '@/components/documents/document-row';
import { DocumentCalendarFlow } from '@/features/calendar/document-calendar-flow';
import { CaptureFlow } from '@/components/documents/capture-flow';
import { DocumentEditSheet } from '@/components/documents/document-edit-sheet';
import { DocumentPreview, isPdfFilename, openDocumentExternally } from '@/components/documents/document-preview';

/** Reverse a `doc-reminder:<id>:expiry` household_tasks template_key into the document id. */
function parseDocReminderKey(templateKey: string | null): string | null {
  if (!templateKey?.startsWith('doc-reminder:')) return null;
  const rest = templateKey.slice('doc-reminder:'.length);
  const lastColon = rest.lastIndexOf(':');
  return lastColon < 0 ? null : rest.slice(0, lastColon);
}

// Reorder a list so docs sharing a cost are adjacent; the order is the
// pairing (mirrors apps/web/src/app/documents/page.tsx's groupByCost).
function groupByCost(list: UnifiedDocument[], costIdByKey: Record<string, string>) {
  const counts: Record<string, number> = {};
  for (const d of list) {
    const c = costIdByKey[d.key];
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }
  const ordered: UnifiedDocument[] = [];
  const placed = new Set<string>();
  for (const d of list) {
    if (placed.has(d.key)) continue;
    ordered.push(d);
    placed.add(d.key);
    const c = costIdByKey[d.key];
    if (c && counts[c] > 1) {
      for (const o of list) {
        if (!placed.has(o.key) && costIdByKey[o.key] === c) {
          ordered.push(o);
          placed.add(o.key);
        }
      }
    }
  }
  return { ordered };
}

type ExpiryFilter = 'all' | 'soon' | 'expired';
type SortKey = 'recent' | 'expiry' | 'name';
/** A document or folder being filed, with where it sits now and its name. */
type MoveTarget = { kind: 'document' | 'folder'; id: string; from: string | null; name: string };

const EXPIRY_OPTIONS: { value: ExpiryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'soon', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
];
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'expiry', label: 'Soonest' },
  { value: 'name', label: 'A–Z' },
];
const SORT_LABEL: Record<SortKey, string> = { recent: 'Newest', expiry: 'Soonest', name: 'A–Z' };

// Folders and documents share one FlashList, so the row type is a union
// rather than a second list stacked above the first. Each section opens with
// its own label row; folders render two tiles to a row (the grid), and each
// document row draws its slice of its section's card.
type DocRow =
  | { kind: 'label'; id: string; label: string; count: number; first: boolean }
  | { kind: 'folders'; id: string; folders: DocumentFolder[] }
  | { kind: 'doc'; id: string; doc: UnifiedDocument; pos: RowPos };

/** Folder tiles per grid row on a phone. */
const FOLDER_COLUMNS = 2;

function rowPos(index: number, length: number): RowPos {
  if (length === 1) return 'only';
  if (index === 0) return 'first';
  return index === length - 1 ? 'last' : 'middle';
}

/**
 * One document row's slice of its section's card. FlashList renders rows
 * flat, so each row draws its part of the frame: the v2 card's rounded-3xl
 * corners on the ends, the shared border at 60% and a hairline between rows
 * (H4: the card is the only border level; rows are never cards of their own).
 */
function docFrameClass(pos: RowPos): string {
  return cn(
    'border-x border-border/60 bg-card',
    (pos === 'first' || pos === 'only') && 'rounded-t-3xl border-t',
    (pos === 'last' || pos === 'only') && 'rounded-b-3xl border-b',
    (pos === 'middle' || pos === 'last') && 'border-t'
  );
}

/** A filter chip: ~32px to the eye, hit slop takes the touch target to 44px (F). */
function FilterChip({
  active,
  onPress,
  children,
  accessibilityLabel,
  expanded,
}: {
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
  /** Set for a disclosure chip instead of a toggle. */
  expanded?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded === undefined ? { selected: active } : { expanded }}
      className={cn('min-h-8 flex-row items-center gap-1 rounded-full px-3', active ? 'bg-primary' : 'bg-muted')}
    >
      {children}
    </Pressable>
  );
}

const chipText = (active: boolean) =>
  cn('text-xs font-medium', active ? 'text-primary-foreground' : 'text-muted-foreground');

interface DocumentsListHeaderProps {
  /** The Hero lede: what the screen (or the open folder) holds; null until the first load lands. */
  lede: { value: number; label: string; soon: number; expired: number } | null;
  /** Search and filters; hidden while there is nothing to filter. */
  showFilters: boolean;
  onAddDocument: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  expiryFilter: ExpiryFilter;
  onExpiryFilterChange: (value: ExpiryFilter) => void;
  sortLabel: string;
  onOpenSort: () => void;
  categoryFilters: Set<DocType>;
  typesOpen: boolean;
  onToggleTypes: () => void;
  onToggleCategory: (c: DocType) => void;
  onSelectPreset: (types: DocType[], active: boolean) => void;
  onClearFilters: () => void;
  tagFilters: string[];
  onToggleTagFilter: (t: string) => void;
  folders: DocumentFolder[];
  folderId: string | null;
  onNavigateFolder: (id: string | null) => void;
  onNewFolder: () => void;
  browsing: boolean;
}

/** HOUP-205: the documents filter/search cluster, hoisted into `FlashList`'s `ListHeaderComponent`
 * so it scrolls with content. Passed as a memoized element (never an inline closure) — see the
 * `listHeader` memo below — so its `SectionSearchBar` TextInput never remounts mid-type. */
function DocumentsListHeader({
  lede,
  showFilters,
  onAddDocument,
  search,
  onSearchChange,
  expiryFilter,
  onExpiryFilterChange,
  sortLabel,
  onOpenSort,
  categoryFilters,
  typesOpen,
  onToggleTypes,
  onToggleCategory,
  onSelectPreset,
  onClearFilters,
  tagFilters,
  onToggleTagFilter,
  folders,
  folderId,
  onNavigateFolder,
  onNewFolder,
  browsing,
}: DocumentsListHeaderProps) {
  return (
    <View className="gap-3 pb-1">
      {/* Section screen head (Hearth §11): the screen's name, or the path to
          the open folder, on the left; its actions on the right. M1: "Add"
          lives here, not a floating button stacked over the tab bar's
          capture FAB. While a search or filter spans the whole tree the path
          would lie, so it reads plain "Documents" then. */}
      <View className="min-h-9 flex-row items-center justify-between gap-3">
        <FolderPath folders={folders} folderId={browsing ? folderId : null} onNavigate={onNavigateFolder} />
        <View className="flex-row items-center gap-2">
          {browsing && <NewFolderButton onPress={onNewFolder} />}
          <Button size="sm" hitSlop={4} onPress={onAddDocument} accessibilityLabel="Add document">
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Add</Text>
          </Button>
        </View>
      </View>

      {/* H1: one lede, on the ground. At the top level it counts every
          document; inside a folder, what the folder holds ("3 in Home").
          Held back until the first load lands, so it never flashes "0". */}
      {lede && (
        <HeroLede
          className="mb-2"
          value={lede.value}
          label={lede.label}
          caption={
            lede.soon > 0 || lede.expired > 0 ? (
              <>
                {lede.soon > 0 && <Text className="text-caption text-warning">{lede.soon} expiring soon</Text>}
                {lede.soon > 0 && lede.expired > 0 && ' · '}
                {lede.expired > 0 && <Text className="text-caption text-destructive">{lede.expired} expired</Text>}
              </>
            ) : undefined
          }
        />
      )}

      {/* Filters (H5), inset controls directly above the list they scope.
          With nothing filed yet there is nothing to filter, so they hide (H)
          and "Add" above stays the way in. */}
      {showFilters && (
        <>
          <SectionSearchBar value={search} onChange={onSearchChange} placeholder="Search documents…" />

          {/* H5: the expiry filter is a recessed segmented track (one border
              level, H4); sort is a compact control beside it that opens a
              BottomSheet picker. */}
          <View className="flex-row items-center gap-2">
            <SegmentedControl
              options={EXPIRY_OPTIONS}
              value={expiryFilter}
              onChange={onExpiryFilterChange}
              size="sm"
              accessibilityLabel="Filter by expiry"
              className="min-h-11 flex-1"
            />
            <Pressable
              onPress={onOpenSort}
              accessibilityRole="button"
              accessibilityLabel={`Sort documents, ${sortLabel}`}
              className="min-h-11 flex-row items-center gap-1 rounded-lg bg-muted/40 px-3"
            >
              <Text className="text-xs font-medium text-foreground">{sortLabel}</Text>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Pressable>
          </View>

          {/* Quick presets, then every type behind "More types" (H: chrome
              shrinks). Wrapping, not a scroller, so no chip clips at an edge. */}
          <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-3">
            {PRESETS.map((p) => {
              const active = sameSet(categoryFilters, p.types);
              return (
                <FilterChip key={p.label} active={active} onPress={() => onSelectPreset(p.types, active)}>
                  <Text className={chipText(active)}>{p.label}</Text>
                </FilterChip>
              );
            })}
            <FilterChip active={false} expanded={typesOpen} onPress={onToggleTypes} accessibilityLabel="More types">
              <Text className={chipText(false)}>More types</Text>
              <ChevronDown
                size={14}
                className="text-muted-foreground"
                style={typesOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
              />
            </FilterChip>
            {(categoryFilters.size > 0 || tagFilters.length > 0) && (
              <Pressable onPress={onClearFilters} hitSlop={8} accessibilityRole="button" className="min-h-8 justify-center px-2">
                <Text className="text-xs font-medium text-primary">Clear</Text>
              </Pressable>
            )}
          </View>

          {typesOpen && (
            <View className="flex-row flex-wrap gap-x-1.5 gap-y-3">
              {TYPE_FILTERS.map((t) => {
                const active = categoryFilters.has(t);
                return (
                  <FilterChip key={t} active={active} onPress={() => onToggleCategory(t)}>
                    <Text className={chipText(active)}>{docTypeLabel(t)}</Text>
                  </FilterChip>
                );
              })}
            </View>
          )}

          {tagFilters.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-3">
              {tagFilters.map((t) => (
                <FilterChip key={t} active onPress={() => onToggleTagFilter(t)} accessibilityLabel={`Remove tag filter ${t}`}>
                  <Text className={chipText(true)}>#{t}</Text>
                  <X size={12} className="text-primary-foreground" />
                </FilterChip>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default function DocumentsSectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group, memberProfiles, loading: cacheLoading } = useDataCache();
  const groupId = group?.id ?? null;

  useReconnectSync(documents$(groupId));
  const storeLoaded = useStoreLoaded(documents$(groupId));
  const nativeDocs = use$(() =>
    Object.values(documents$(groupId).get() ?? {}).filter((d): d is Document => !!d && !d.deleted)
  );

  const [docs, setDocs] = React.useState<UnifiedDocument[]>([]);
  const [links, setLinks] = React.useState<DocumentLink[]>([]);
  const [costItems, setCostItems] = React.useState<CostItem[]>([]);
  const [reminderByDoc, setReminderByDoc] = React.useState<Record<string, string>>({});
  const [groupTags, setGroupTags] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Modules: bill links, cost grouping and legacy bill files need documents and
  // costs; legacy grocery receipts need documents and groceries; "Open reminder"
  // needs household and documents (module-features.ts).
  const modules = useModules();
  const costsOn = modules.feature('documents.costs');
  const groceriesOn = modules.feature('documents.groceries');
  const reminderLinkOn = modules.feature('tasks.from-document');
  // "Add to calendar" on a document links it to an event or makes one from it (document-calendar-flow.tsx).
  const calendarOn = modules.feature('calendar.event-documents');
  const [calendarDoc, setCalendarDoc] = React.useState<UnifiedDocument | null>(null);

  const [categoryFilters, setCategoryFilters] = React.useState<Set<DocType>>(new Set());
  // The fourteen type chips fold behind "More types" (H: chrome shrinks);
  // they stay open while a type outside the presets is the active filter.
  const [typesExpanded, setTypesExpanded] = React.useState(false);
  const presetActive = PRESETS.some((p) => sameSet(categoryFilters, p.types));
  const typesOpen = typesExpanded || (categoryFilters.size > 0 && !presetActive);
  const [expiryFilter, setExpiryFilter] = React.useState<ExpiryFilter>('all');
  const [tagFilters, setTagFilters] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<SortKey>('recent');
  const [sortSheetOpen, setSortSheetOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const [folders, setFolders] = React.useState<DocumentFolder[]>([]);
  const [folderId, setFolderId] = React.useState<string | null>(null);
  // What the move sheet is filing, and where it sits now. Kept after the
  // sheet closes so its title doesn't change mid-dismiss; moveOpen drives it.
  const [moving, setMoving] = React.useState<MoveTarget | null>(null);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const startMove = (target: MoveTarget) => {
    setMoving(target);
    setMoveOpen(true);
  };
  // Select mode: a tap ticks a document instead of opening it, and the bar at
  // the foot files or deletes every ticked one at once. Keyed by the merged
  // list's key, so legacy files can be ticked too. Ticks survive browsing
  // between folders, so a selection can gather files from anywhere.
  const [selecting, setSelecting] = React.useState(false);
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set());
  // What the bulk move sheet is filing, read when it opens so its title holds
  // while it dismisses (the selection clears the moment a folder is picked).
  const [bulkMove, setBulkMove] = React.useState<{ count: number; from: string | null | undefined }>({ count: 0, from: undefined });
  const [bulkMoveOpen, setBulkMoveOpen] = React.useState(false);
  // The folder the delete sheet is about, read when it opens and kept while
  // the sheet dismisses, by which time the folder is gone.
  const [deleting, setDeleting] = React.useState<{ id: string; name: string; count: number } | null>(null);
  const [deleteFolderOpen, setDeleteFolderOpen] = React.useState(false);
  // Null when closed; { id: null } creates, { id } renames.
  const [naming, setNaming] = React.useState<{ id: string | null; current: string } | null>(null);

  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [editingDoc, setEditingDoc] = React.useState<Document | null>(null);
  const [previewingDoc, setPreviewingDoc] = React.useState<UnifiedDocument | null>(null);

  const toggleCategory = (c: DocType) =>
    setCategoryFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  const toggleTagFilter = (t: string) =>
    setTagFilters((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const costNames = React.useMemo(() => Object.fromEntries(costItems.map((c) => [c.id, c.name])), [costItems]);

  const load = React.useCallback(async () => {
    if (!groupId) return;
    const supabase = getCurrentSupabaseClient();
    const [d, l, c, reminders, tags, f] = await Promise.all([
      listUnifiedDocuments(supabase, groupId, nativeDocs, { costs: costsOn, groceries: groceriesOn }),
      listLinksForGroup(supabase, groupId),
      costsOn ? listCostItems(supabase, groupId) : Promise.resolve([] as CostItem[]),
      supabase.from('household_tasks').select('id, template_key').eq('group_id', groupId).like('template_key', 'doc-reminder:%'),
      listDocumentTags(supabase, groupId),
      listDocumentFolders(supabase, groupId),
    ]);
    setDocs(d);
    setLinks(l);
    setCostItems(c);
    setGroupTags(tags);
    setFolders(f);
    const map: Record<string, string> = {};
    for (const r of (reminders.data ?? []) as { id: string; template_key: string | null }[]) {
      const originId = parseDocReminderKey(r.template_key);
      if (originId) map[originId] = r.id;
    }
    setReminderByDoc(map);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, nativeDocs, costsOn, groceriesOn]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Live-refresh when document LINKS change in this group (mirrors web's
  // useGroupTableRefetch at apps/web/src/app/documents/page.tsx:212) — native
  // document rows already repaint reactively via `nativeDocs`/`load`'s
  // dependency on it, so only the legacy-adjacent `document_links` table
  // needs a realtime-triggered refetch here.
  useGroupTableRefetch({ table: 'document_links', groupId, refetch: () => void load() });

  // Folder mutations reload rather than patching local state: the document
  // list is a merge of the store and two legacy tables, so a hand-rolled
  // optimistic patch would have to reproduce that merge.
  const withFolders = React.useCallback(
    async (fn: (supabase: ReturnType<typeof getCurrentSupabaseClient>) => Promise<void>) => {
      if (!groupId) return;
      try {
        await fn(getCurrentSupabaseClient());
        await load();
      } catch (e) {
        console.error('Folder operation failed:', e);
      }
    },
    [groupId, load]
  );

  // Creating a folder shows it straight away: the row is drafted locally with
  // its final id and inserted in the background, instead of waiting on an
  // auth round trip, the insert and a reload of every document table before
  // anything appears. A failed insert takes it back out.
  const createFolder = async (name: string): Promise<DocumentFolder | null> => {
    if (!groupId) return null;
    const supabase = getCurrentSupabaseClient();
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
    void renameDocumentFolder(getCurrentSupabaseClient(), id, name).catch((e) => {
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
    void deleteDocumentFolder(getCurrentSupabaseClient(), folders, id).catch((e) => {
      console.error('Folder operation failed:', e);
      toast.error("Couldn't delete that folder");
      void load();
    });
  };

  const submitFolderName = (name: string) => {
    const target = naming;
    setNaming(null);
    if (!target) return;
    if (target.id) renameFolder(target.id, name);
    else void createFolder(name);
  };

  // The sheet asks what happens to the documents inside; deleting them with
  // the folder takes a second, explicit confirm (FolderDeleteSheet).
  const confirmDeleteFolder = (id: string) => {
    const subtree = folderDescendantIds(folders, id);
    subtree.add(id);
    haptics.warn();
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
    haptics.remove();
    // Standing inside the folder being deleted (or under it) would leave the
    // view pointing at a folder that no longer exists.
    if (folderId === id || (folderId && folderDescendantIds(folders, id).has(folderId))) setFolderId(null);
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

  // Filing choreography state, keyed by flatData row id.
  const [leavingKey, setLeavingKey] = React.useState<string | null>(null);
  const [receivingFolderId, setReceivingFolderId] = React.useState<string | null>(null);
  const listRef = React.useRef<FlashListRef<DocRow>>(null);

  // The list closes (or reopens) the gap at settle instead of jumping.
  const animateReflow = () => {
    listRef.current?.prepareForLayoutAnimationRender();
    LayoutAnimation.configureNext(LayoutAnimation.create(ROW_LEAVE_MS, 'easeInEaseOut', 'opacity'));
  };

  // A row or tile filed out of the folder on screen first plays its exit
  // (MoveMotion), then the data changes and the list breathes up; a folder
  // tile on screen that receives it swells and washes so the eye lands where
  // it went. The toast says where it went and offers the way back.
  const confirmMove = (target: MoveTarget, destination: string | null, destinationName: string) => {
    const rowKey = target.kind === 'folder' ? `folder:${target.id}` : docs.find((d) => d.storeId === target.id)?.key;
    const onScreen =
      target.kind === 'folder'
        ? childFolders.some((f) => f.id === target.id)
        : flatData.some((r) => r.kind === 'doc' && r.id === rowKey);
    // A search spans the whole tree, so there a moved row stays where it is.
    const leavesView = browsing && destination !== folderId && !!rowKey && onScreen;
    const landsOnScreen = destination !== null && childFolders.some((f) => f.id === destination);
    const land = () => {
      animateReflow();
      applyMove(target, destination);
      setLeavingKey(null);
      haptics.commit();
      if (landsOnScreen) {
        setReceivingFolderId(destination);
        setTimeout(() => setReceivingFolderId(null), 700);
      }
    };
    if (leavesView && rowKey) {
      setLeavingKey(rowKey);
      setTimeout(land, ROW_LEAVE_MS);
    } else {
      land();
    }
    toast.message(`Moved to ${destinationName}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onPress: () => {
          animateReflow();
          applyMove(target, target.from);
        },
      },
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

  // Android back climbs out of a folder before it leaves the section; the
  // tabs navigator's history back would otherwise jump to another section.
  // Open sheets are Modals and take back themselves before this sees it.
  // Back ends select mode first.
  useFocusEffect(
    React.useCallback(() => {
      if (folderId === null && !selecting) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (selecting) {
          setSelecting(false);
          setSelectedKeys(new Set());
        } else {
          setFolderId(folders.find((f) => f.id === folderId)?.parent_id ?? null);
        }
        return true;
      });
      return () => sub.remove();
    }, [folderId, folders, selecting])
  );

  // Browsing means "no query, no filters": folders only structure the plain
  // list. A search or filter looks across the whole tree instead, because
  // finding nothing merely for standing in the wrong folder is worse than a
  // flat result that spans folders.
  const browsing =
    search.trim() === '' && categoryFilters.size === 0 && tagFilters.length === 0 && expiryFilter === 'all';
  // Memoized: a fresh array each render would defeat flatData's memo below.
  const childFolders = React.useMemo(
    () => (browsing ? foldersInParent(folders, folderId) : []),
    [browsing, folders, folderId]
  );

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

  const searchedDocs = useFuzzySearch(filtered, search, ['filename', 'title']);

  const sortedDocs = React.useMemo(() => {
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
    }
    return arr;
  }, [searchedDocs, sort]);

  // "Expiring soon" leads the files only when the list isn't already
  // filtered or sorted by expiry, where it would just repeat the list.
  const showSoonGroup = expiryFilter === 'all' && sort !== 'expiry';
  const sections = React.useMemo(() => documentListSections(sortedDocs, showSoonGroup), [sortedDocs, showSoonGroup]);

  // Links into a switched-off module don't render (and don't pair by cost).
  const linksByDoc = React.useMemo(() => {
    const m = new Map<string, DocumentLink[]>();
    for (const l of visibleDocumentLinks(links, modules.feature)) {
      const arr = m.get(l.document_id) ?? [];
      arr.push(l);
      m.set(l.document_id, arr);
    }
    return m;
  }, [links, modules]);

  const costIdByKey = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of docs) {
      const dl = d.storeId ? (linksByDoc.get(d.storeId) ?? []) : [];
      const cost = dl.find((l) => l.entity_type === 'cost_item');
      if (cost) m[d.key] = cost.entity_id;
    }
    return m;
  }, [docs, linksByDoc]);

  // The Hero lede counts what the surface holds: every document at the top
  // level (and while a search spans the tree), the open folder's whole
  // subtree inside one. Its caption is that set's expiry state.
  const openFolder = browsing && folderId !== null ? (folders.find((f) => f.id === folderId) ?? null) : null;
  const ledeDocs = React.useMemo(() => {
    if (!openFolder) return docs;
    const subtree = folderDescendantIds(folders, openFolder.id);
    subtree.add(openFolder.id);
    return docs.filter((d) => d.folderId != null && subtree.has(d.folderId));
  }, [docs, folders, openFolder]);
  const expiryCounts = React.useMemo(() => documentExpiryCounts(ledeDocs), [ledeDocs]);

  const openLink = (link: Pick<DocumentLink, 'entity_type' | 'entity_id'>) => router.push(documentLinkHref(link) as Href);

  const remove = (doc: UnifiedDocument) => {
    if (!doc.storeId) return;
    haptics.warn();
    Alert.alert(`Delete "${doc.title || doc.filename}"?`, 'This removes it from the store.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          haptics.remove();
          dropNow(doc);
        },
      },
    ]);
  };

  // Legacy files (bill attachments, grocery receipts) have no store row to
  // edit, file or remind on. The first such action adopts the file into the
  // store, which the old Adopt button did as a separate step, and seeds the
  // store with the new row so the action lands on it at once.
  const adoptLegacy = async (doc: UnifiedDocument): Promise<Document | null> => {
    try {
      const row = await adoptLegacyDocument(getCurrentSupabaseClient(), doc);
      seedRow(row);
      return row;
    } catch (e) {
      console.error('Adopting a legacy file failed:', e);
      toast.error("Couldn't open that file for editing");
      return null;
    }
  };

  const moveDoc = (doc: UnifiedDocument) => {
    const name = doc.title || doc.filename;
    if (isFilable(doc)) {
      startMove({ kind: 'document', id: doc.storeId as string, from: doc.folderId ?? null, name });
      return;
    }
    void adoptLegacy(doc).then((row) => {
      if (row) startMove({ kind: 'document', id: row.id, from: null, name });
    });
  };

  const removeLegacy = (doc: UnifiedDocument) => {
    haptics.warn();
    Alert.alert(`Delete "${doc.title || doc.filename}"?`, `This removes the file from its source.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          haptics.remove();
          dropNow(doc);
        },
      },
    ]);
  };

  // Deletes documents already taken off the list: store rows (and their
  // reminders) and legacy files from their source. Failures put back what
  // the server still holds via the reload.
  const deleteDocuments = async (picked: UnifiedDocument[]) => {
    if (picked.length === 0) return;
    const supabase = getCurrentSupabaseClient();
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

  const selectedDocs = React.useMemo(() => docs.filter((d) => selectedKeys.has(d.key)), [docs, selectedKeys]);

  const startSelect = (doc: UnifiedDocument) => {
    haptics.select();
    setSelecting(true);
    setSelectedKeys(new Set([doc.key]));
  };

  const exitSelect = () => {
    setSelecting(false);
    setSelectedKeys(new Set());
  };

  const toggleSelect = (doc: UnifiedDocument) => {
    haptics.select();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(doc.key)) next.delete(doc.key);
      else next.add(doc.key);
      return next;
    });
  };

  const countLabel = (n: number) => (n === 1 ? '1 document' : `${n} documents`);

  // Files every picked document into one folder. Store rows move at once;
  // legacy files are adopted first, then filed, same as a single move. One
  // toast covers the lot, and its Undo puts each back where it was.
  const fileDocuments = async (picked: UnifiedDocument[], destination: string | null, destinationName: string) => {
    if (picked.length === 0) return;
    const moved: { id: string; from: string | null }[] = [];
    animateReflow();
    for (const d of picked) {
      if (!d.storeId) continue;
      moved.push({ id: d.storeId, from: d.folderId ?? null });
      patchRow(d.storeId, { folder_id: destination });
    }
    const movedKeys = new Set(picked.filter((d) => d.storeId).map((d) => d.key));
    setDocs((prev) => prev.map((d) => (movedKeys.has(d.key) ? { ...d, folderId: destination } : d)));
    haptics.commit();
    if (destination !== null && childFolders.some((f) => f.id === destination)) {
      setReceivingFolderId(destination);
      setTimeout(() => setReceivingFolderId(null), 700);
    }
    const legacy = picked.filter((d) => !d.storeId);
    if (legacy.length > 0) {
      const rows = await Promise.all(legacy.map(adoptLegacy));
      for (const row of rows) {
        if (!row) continue;
        patchRow(row.id, { folder_id: destination });
        moved.push({ id: row.id, from: null });
      }
    }
    if (moved.length === 0) return;
    toast.message(`Moved ${countLabel(moved.length)} to ${destinationName}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onPress: () => {
          animateReflow();
          const fromById = new Map(moved.map((m) => [m.id, m.from]));
          for (const m of moved) patchRow(m.id, { folder_id: m.from });
          setDocs((prev) =>
            prev.map((d) => (d.storeId && fromById.has(d.storeId) ? { ...d, folderId: fromById.get(d.storeId) ?? null } : d))
          );
        },
      },
    });
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

  const deleteSelected = () => {
    const picked = selectedDocs;
    if (picked.length === 0) return;
    const fromSources = picked.some((d) => !d.storeId);
    haptics.warn();
    Alert.alert(
      `Delete ${countLabel(picked.length)}?`,
      fromSources
        ? 'Files from bills and receipts are removed from those too. This can’t be undone.'
        : 'They are deleted for everyone in the household. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptics.remove();
            exitSelect();
            const keys = new Set(picked.map((d) => d.key));
            animateReflow();
            setDocs((prev) => prev.filter((d) => !keys.has(d.key)));
            void deleteDocuments(picked);
          },
        },
      ]
    );
  };

  // The move sheet checks where the ticked documents sit, when they all sit
  // in one place; spread across folders, no row is current.
  const openBulkMove = () => {
    const places = new Set(selectedDocs.map((d) => d.folderId ?? null));
    setBulkMove({ count: selectedDocs.length, from: places.size === 1 ? [...places][0] : undefined });
    setBulkMoveOpen(true);
  };

  const setReminder = async (legacyOrStored: UnifiedDocument) => {
    let doc = legacyOrStored;
    if (!doc.storeId) {
      const row = await adoptLegacy(doc);
      if (!row) return;
      doc = { ...doc, storeId: row.id };
    }
    if (!doc.storeId) return;
    const supabase = getCurrentSupabaseClient();
    const name = doc.title || doc.filename;
    if (doc.expiryDate) {
      await syncDocumentReminder(supabase, { id: doc.storeId, groupId: doc.groupId, name, expiryDate: doc.expiryDate });
    } else {
      await createManualReminder(supabase, {
        groupId: doc.groupId, templateKey: reminderKey('document', doc.storeId, 'expiry'), title: `Renew ${name}`,
      });
    }
    await load();
  };

  const share = async (doc: UnifiedDocument) => {
    const supabase = getCurrentSupabaseClient();
    const url = await signedDocumentUrl(supabase, doc.storagePath, SIGNED_URL_TTL_SECONDS, doc.bucket);
    if (!url) return;
    try {
      const localUri = `${FileSystem.cacheDirectory}${doc.filename}`;
      const { uri } = await FileSystem.downloadAsync(url, localUri);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
        return;
      }
    } catch {
      // fall through to a link share below
    }
    await RNShare.share({ message: url, url, title: doc.title || doc.filename });
  };

  const preview = async (doc: UnifiedDocument) => {
    if (isPdfFilename(doc.filename)) {
      await openDocumentExternally(getCurrentSupabaseClient(), doc.storagePath, doc.bucket);
    } else {
      setPreviewingDoc(doc);
    }
  };

  const openEdit = (doc: UnifiedDocument) => {
    if (!doc.storeId) {
      void adoptLegacy(doc).then((row) => row && setEditingDoc(row));
      return;
    }
    const row = nativeDocs.find((d) => d.id === doc.storeId);
    if (row) setEditingDoc(row);
  };

  // HOUP-205: one flat FlashList data array. Every section opens with its own
  // label row (micro label + count), so a folder never reads as another file:
  // "Folders" is a two-column grid of tiles, then "Expiring soon" and "Files"
  // are each one card of document rows. Inside a section docs sharing a cost
  // sit next to each other; the order is the pairing (no rail, §3).
  const flatData = React.useMemo<DocRow[]>(() => {
    const rows: DocRow[] = [];
    if (childFolders.length > 0) {
      rows.push({ kind: 'label', id: 'label:folders', label: 'Folders', count: childFolders.length, first: true });
      for (let i = 0; i < childFolders.length; i += FOLDER_COLUMNS) {
        const tiles = childFolders.slice(i, i + FOLDER_COLUMNS);
        rows.push({ kind: 'folders', id: `folders:${tiles.map((f) => f.id).join(':')}`, folders: tiles });
      }
    }
    for (const section of sections) {
      const { ordered } = groupByCost(section.docs, costIdByKey);
      rows.push({ kind: 'label', id: `label:${section.key}`, label: section.label, count: ordered.length, first: rows.length === 0 });
      ordered.forEach((doc, i) => rows.push({ kind: 'doc', id: doc.key, doc, pos: rowPos(i, ordered.length) }));
    }
    return rows;
  }, [childFolders, sections, costIdByKey]);

  const renderItem = React.useCallback<ListRenderItem<DocRow>>(
    ({ item, index }) => {
      if (item.kind === 'label') {
        return <DocumentsSectionLabel label={item.label} count={item.count} first={item.first} />;
      }
      if (item.kind === 'folders') {
        const prev = index > 0 ? flatData[index - 1] : undefined;
        return (
          <View className={cn('flex-row gap-3', prev?.kind === 'folders' && 'mt-3')}>
            {item.folders.map((f) => (
              <FolderTile
                key={f.id}
                folder={f}
                folders={folders}
                documents={docs}
                onOpen={() => setFolderId(f.id)}
                onRename={() => setNaming({ id: f.id, current: f.name })}
                onMove={() => startMove({ kind: 'folder', id: f.id, from: f.parent_id ?? null, name: f.name })}
                onDelete={() => confirmDeleteFolder(f.id)}
                leaving={leavingKey === `folder:${f.id}`}
                receiving={receivingFolderId === f.id}
              />
            ))}
            {/* An odd last tile keeps its column's width. */}
            {item.folders.length < FOLDER_COLUMNS && <View className="flex-1" />}
          </View>
        );
      }
      const { doc: d } = item;
      return (
        <MoveMotion className={docFrameClass(item.pos)} leaving={leavingKey === item.id} receiving={false}>
          <DocumentRow
            doc={d}
            costLinks={d.storeId ? (linksByDoc.get(d.storeId) ?? []) : []}
            costNames={costNames}
            memberProfiles={memberProfiles}
            reminderTaskId={d.storeId ? (reminderByDoc[d.storeId] ?? null) : null}
            onPreview={preview}
            onEdit={openEdit}
            onDelete={remove}
            onDeleteLegacy={removeLegacy}
            onSetReminder={setReminder}
            onShare={share}
            onToggleTag={toggleTagFilter}
            onMoveToFolder={() => moveDoc(d)}
            onAddToCalendar={calendarOn && d.storeId ? () => setCalendarDoc(d) : null}
            onOpenReminder={reminderLinkOn ? (taskId) => router.push(`/tasks?focus=${taskId}`) : null}
            onOpenLink={openLink}
            onSelect={startSelect}
            selecting={selecting}
            selected={selectedKeys.has(d.key)}
            onToggleSelect={toggleSelect}
          />
        </MoveMotion>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flatData, linksByDoc, costNames, memberProfiles, reminderByDoc, folders, docs, reminderLinkOn, calendarOn, leavingKey, receivingFolderId, selecting, selectedKeys]
  );

  // Stable memoized element (never an inline `() => <Header/>` closure) so the
  // SectionSearchBar TextInput inside it never remounts and loses focus mid-type.
  const listHeader = React.useMemo(
    () => (
      <DocumentsListHeader
        lede={
          loading
            ? null
            : {
                value: ledeDocs.length,
                label: openFolder
                  ? `in ${openFolder.name}`
                  : ledeDocs.length === 1
                    ? 'document'
                    : 'documents',
                soon: expiryCounts.soon,
                expired: expiryCounts.expired,
              }
        }
        // With nothing filed yet there is nothing to filter.
        showFilters={loading || docs.length > 0}
        onAddDocument={() => setCaptureOpen(true)}
        search={search}
        onSearchChange={setSearch}
        expiryFilter={expiryFilter}
        onExpiryFilterChange={setExpiryFilter}
        sortLabel={SORT_LABEL[sort]}
        onOpenSort={() => setSortSheetOpen(true)}
        categoryFilters={categoryFilters}
        typesOpen={typesOpen}
        onToggleTypes={() => setTypesExpanded(!typesOpen)}
        onToggleCategory={toggleCategory}
        onSelectPreset={(types, active) => setCategoryFilters(active ? new Set() : new Set(types))}
        onClearFilters={() => { setCategoryFilters(new Set()); setTagFilters([]); }}
        tagFilters={tagFilters}
        onToggleTagFilter={toggleTagFilter}
        folders={folders}
        folderId={folderId}
        onNavigateFolder={setFolderId}
        onNewFolder={() => setNaming({ id: null, current: '' })}
        browsing={browsing}
      />
    ),
    [loading, ledeDocs.length, openFolder, docs.length, expiryCounts, search, expiryFilter, sort, categoryFilters, typesOpen, tagFilters, folders, folderId, browsing]
  );

  const clearAllFilters = () => {
    setSearch('');
    setCategoryFilters(new Set());
    setTagFilters([]);
    setExpiryFilter('all');
  };

  // Hearth §11 empty states: centered on the ground, one headline, one line.
  // "Add" already heads the screen (M1), so the first-run state points at it
  // instead of stacking a second primary button under it (H5).
  const emptyComponent = !browsing ? (
    <EmptyState
      icon={SearchX}
      title="Nothing matches"
      description="Try another search, or clear the filters."
      secondaryAction={{ label: 'Clear filters', onPress: clearAllFilters }}
    />
  ) : folderId !== null ? (
    <EmptyState icon={FolderOpen} title="This folder is empty" description="File a document here with Move to folder in its menu." />
  ) : (
    <EmptyState
      icon={FileText}
      title="No documents yet"
      description="Tap Add to keep receipts, warranties, IDs and leases in one place."
    />
  );

  if (cacheLoading || (!storeLoaded && docs.length === 0 && loading)) {
    return (
      <ScreenBackground className="items-center justify-center">
        <ActivityIndicator />
      </ScreenBackground>
    );
  }

  if (!group) {
    return <NoGroupScreen />;
  }

  return (
    <ScreenBackground>
      <FlashList
        ref={listRef}
        data={flatData}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyComponent}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: insets.top + 16,
          // PrimaryTabBar sits in flow under this screen and pads the safe
          // area itself, so the list only clears the capture button's raised
          // lip (~20px). `insets.bottom + 96` (sized for a floating bar)
          // left a ~120-150px empty band under the last card on every phone.
          // Select mode's bar floats over the foot of the list; the last
          // row must be able to scroll clear of it.
          paddingBottom: selecting ? 96 : 32,
        }}
      />

      {selecting && (
        <View
          className="absolute inset-x-4 bottom-4 flex-row items-center gap-2 rounded-2xl border border-border bg-popover py-2 pl-4 pr-2 shadow-lg"
        >
          <Text className="flex-1 text-sm font-medium tabular-nums text-foreground" numberOfLines={1}>
            {selectedKeys.size === 0 ? 'Tap documents to select' : `${selectedKeys.size} selected`}
          </Text>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedKeys.size === 0}
            onPress={openBulkMove}
            accessibilityLabel="Move selected documents"
          >
            <FolderInput size={14} className="text-foreground" />
            <Text className="text-sm font-medium text-foreground">Move</Text>
          </Button>
          {/* E4: destructive is danger text, never a fill. */}
          <Button
            size="sm"
            variant="outline"
            disabled={selectedKeys.size === 0}
            onPress={deleteSelected}
            accessibilityLabel="Delete selected documents"
          >
            <Trash2 size={14} className="text-destructive" />
            <Text className="text-sm font-medium text-destructive">Delete</Text>
          </Button>
          <Pressable
            onPress={exitSelect}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Stop selecting"
            className="h-9 w-9 items-center justify-center rounded-full"
          >
            <X size={16} className="text-muted-foreground" />
          </Pressable>
        </View>
      )}

      <BottomSheet open={sortSheetOpen} onOpenChange={setSortSheetOpen} className="pb-2">
        <Text className="px-3.5 pb-1 pt-1 text-micro-label uppercase text-muted-foreground">Sort by</Text>
        <ListGroup className="mx-1.5 mb-1.5 border-0 bg-transparent">
          {SORT_OPTIONS.map((opt) => (
            <ListItem
              key={opt.value}
              onPress={() => { setSort(opt.value); setSortSheetOpen(false); }}
            >
              <ListItemContent>
                <ListItemTitle>{opt.label}</ListItemTitle>
              </ListItemContent>
              {sort === opt.value && (
                <ListItemTrailing>
                  <Check size={16} className="text-primary" />
                </ListItemTrailing>
              )}
            </ListItem>
          ))}
        </ListGroup>
      </BottomSheet>

      <CaptureFlow
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        groupId={group.id}
        groupTags={groupTags}
        onUploaded={() => void load()}
      />

      <DocumentEditSheet
        key={editingDoc?.id ?? 'none'}
        open={!!editingDoc}
        onClose={() => setEditingDoc(null)}
        doc={editingDoc}
        docLinks={editingDoc ? (linksByDoc.get(editingDoc.id) ?? []) : []}
        costItems={costItems}
        groupTags={groupTags}
        onSaved={() => void load()}
      />

      <FolderNameSheet
        open={naming !== null}
        onOpenChange={(open) => { if (!open) setNaming(null); }}
        title={naming?.id ? 'Rename folder' : 'New folder'}
        initialValue={naming?.current ?? ''}
        submitLabel={naming?.id ? 'Rename' : 'Create'}
        onSubmit={submitFolderName}
      />

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
    </ScreenBackground>
  );
}
