'use client';

// The Documents explorer's sidebar (wide web): views across every file, then
// the folder tree. A folder opens on click, its chevron folds it, and a
// right-click gives its menu. Documents dragged from the file table onto a
// folder are filed there. The phone browses the same folders a level at a
// time (folder-ui.tsx).

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Clock, Files, Folder, FolderOpen, FolderPlus, MoreHorizontal, TriangleAlert } from 'lucide-react';
import { folderAncestorIds, folderContentsLabel, folderTreeRows, type DocumentFolder } from '@homeup/core';
import { ListItem, ListItemContent, ListItemLeading, ListItemTitle } from '@/components/ui/list-item';
import { DOC_TABLE_COLUMNS } from '@/app/documents/document-card';
import { rowMotionClass, type RowMotion } from './folder-browser';
import { dialog } from '@homeup/core';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { cn } from '@/lib/utils';

/** The drag payload type a document row carries: its list key. */
export const DOC_DRAG_TYPE = 'application/x-rooftap-document';

export type ExplorerView = 'folder' | 'soon' | 'expired';

function acceptsDocument(e: React.DragEvent) {
  return e.dataTransfer.types.includes(DOC_DRAG_TYPE);
}

/** Drop handlers that file a dragged document into `folderId`, and whether one is over it now. */
function useDocumentDrop(folderId: string | null, onDrop: (docKey: string, folderId: string | null) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!acceptsDocument(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const key = e.dataTransfer.getData(DOC_DRAG_TYPE);
        if (!key) return;
        e.preventDefault();
        onDrop(key, folderId);
      },
    },
  };
}

const NODE =
  'group flex h-9 w-full min-w-0 items-center gap-2 rounded-xl pr-2.5 text-left text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50';

export function FolderTree({
  folders,
  documents,
  folderId,
  view,
  totalCount,
  soonCount,
  expiredCount,
  receivingFolderId,
  onOpenFolder,
  onView,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onDropDocument,
}: {
  folders: DocumentFolder[];
  documents: Array<{ folderId?: string | null }>;
  /** The open folder, null at the top level. */
  folderId: string | null;
  view: ExplorerView;
  totalCount: number;
  soonCount: number;
  expiredCount: number;
  receivingFolderId: string | null;
  onOpenFolder: (id: string | null) => void;
  onView: (view: 'soon' | 'expired') => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onMoveFolder: (folder: DocumentFolder) => void;
  onDeleteFolder: (id: string) => void;
  onDropDocument: (docKey: string, folderId: string | null) => void;
}) {
  // Folded by default; the path to the open folder unfolds by itself.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ancestors = folderAncestorIds(folders, folderId);
    if (ancestors.length === 0) return;
    setExpanded((prev) => (ancestors.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ancestors])));
  }, [folders, folderId]);
  const rows = useMemo(() => folderTreeRows(folders, documents, expanded), [folders, documents, expanded]);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rootDrop = useDocumentDrop(null, onDropDocument);
  const allOn = view === 'folder' && folderId === null;

  return (
    <nav aria-label="Folders" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-3 py-5">
      <button
        type="button"
        onClick={() => onOpenFolder(null)}
        aria-current={allOn ? 'page' : undefined}
        {...rootDrop.handlers}
        className={cn(NODE, 'pl-2.5', allOn && 'bg-primary/10', rootDrop.over && 'bg-accent ring-2 ring-primary/50')}
      >
        <Files className={cn('h-4 w-4 shrink-0', allOn ? 'text-primary' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate text-foreground">All files</span>
        <span className="text-xs tabular-nums text-muted-foreground">{totalCount}</span>
      </button>
      <button
        type="button"
        onClick={() => onView('soon')}
        aria-current={view === 'soon' ? 'page' : undefined}
        className={cn(NODE, 'pl-2.5', view === 'soon' && 'bg-primary/10')}
      >
        <Clock className={cn('h-4 w-4 shrink-0', view === 'soon' ? 'text-primary' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate text-foreground">Expiring soon</span>
        <span className={cn('text-xs tabular-nums', soonCount > 0 ? 'text-warning' : 'text-muted-foreground')}>{soonCount}</span>
      </button>
      {expiredCount > 0 && (
        <button
          type="button"
          onClick={() => onView('expired')}
          aria-current={view === 'expired' ? 'page' : undefined}
          className={cn(NODE, 'pl-2.5', view === 'expired' && 'bg-primary/10')}
        >
          <TriangleAlert className={cn('h-4 w-4 shrink-0', view === 'expired' ? 'text-primary' : 'text-muted-foreground')} />
          <span className="min-w-0 flex-1 truncate text-foreground">Expired</span>
          <span className="text-xs tabular-nums text-destructive">{expiredCount}</span>
        </button>
      )}

      <h2 className="px-2.5 pb-1.5 pt-5 text-xs font-medium text-muted-foreground">Folders</h2>
      {rows.map((row) => (
        <FolderTreeNode
          key={row.folder.id}
          folder={row.folder}
          depth={row.depth}
          hasChildren={row.hasChildren}
          expanded={row.expanded}
          count={row.count}
          open={view === 'folder' && folderId === row.folder.id}
          receiving={receivingFolderId === row.folder.id}
          onOpen={() => onOpenFolder(row.folder.id)}
          onToggle={() => toggle(row.folder.id)}
          onRename={(name) => onRenameFolder(row.folder.id, name)}
          onMove={() => onMoveFolder(row.folder)}
          onDelete={() => onDeleteFolder(row.folder.id)}
          onDropDocument={onDropDocument}
        />
      ))}
      <button
        type="button"
        onClick={async () => {
          const name = await dialog.prompt({ title: 'New folder', placeholder: 'Folder name', confirmLabel: 'Create' });
          if (name?.trim()) onCreateFolder(name.trim());
        }}
        className={cn(NODE, 'pl-2.5 text-muted-foreground hover:text-foreground')}
      >
        <FolderPlus className="h-4 w-4 shrink-0" />
        New folder
      </button>
    </nav>
  );
}

function FolderTreeNode({
  folder,
  depth,
  hasChildren,
  expanded,
  count,
  open,
  receiving,
  onOpen,
  onToggle,
  onRename,
  onMove,
  onDelete,
  onDropDocument,
}: {
  folder: DocumentFolder;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  count: number;
  open: boolean;
  receiving: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onMove: () => void;
  onDelete: () => void;
  onDropDocument: (docKey: string, folderId: string | null) => void;
}) {
  const drop = useDocumentDrop(folder.id, onDropDocument);
  const rename = async () => {
    const name = await dialog.prompt({ title: 'Rename folder', defaultValue: folder.name, confirmLabel: 'Rename' });
    if (name?.trim() && name.trim() !== folder.name) onRename(name.trim());
  };
  // Hearth §13.7 "Row menu": the folder tile's actions, on a right-click.
  const rowMenu = useRowContextMenu(() => ({
    title: folder.name,
    kind: 'Folder',
    actions: [
      { id: 'open', label: 'Open', group: 'open', icon: 'open', run: onOpen },
      { id: 'move', label: 'Move to folder', group: 'set', icon: 'move', run: onMove },
      { id: 'rename', label: 'Rename', group: 'edit', icon: 'edit', run: () => void rename() },
      { id: 'delete', label: 'Delete folder', group: 'danger', icon: 'delete', danger: true, run: onDelete },
    ],
  }));
  const Glyph = open ? FolderOpen : Folder;

  return (
    <div
      onContextMenu={rowMenu.onContextMenu}
      {...drop.handlers}
      className={cn(
        'flex items-center rounded-xl transition-[background-color,transform] duration-[var(--motion-fast)]',
        open && 'bg-primary/10',
        (drop.over || receiving) && 'bg-accent ring-2 ring-primary/50',
        receiving && 'scale-[1.02]'
      )}
      style={{ paddingLeft: depth * 16 }}
    >
      {rowMenu.menu}
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? `Fold ${folder.name}` : `Unfold ${folder.name}`}
          aria-expanded={expanded}
          className="flex h-9 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-[var(--motion-fast)]', expanded && 'rotate-90')} />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? 'page' : undefined}
        className={cn(NODE, 'pl-1 hover:bg-transparent')}
      >
        <Glyph className={cn('h-4 w-4 shrink-0', open ? 'text-primary' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate text-foreground">{folder.name}</span>
        {count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
      </button>
    </div>
  );
}

/**
 * A sub-folder as a row above the files: in the explorer's file table, or in
 * the narrow list's folders card. Click opens it, a right-click or the more
 * button gives its menu, and a document dropped on it is filed inside.
 */
export function FolderTableRow({
  layout = 'table',
  folder,
  folders,
  documents,
  motion,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onDropDocument,
}: {
  layout?: 'table' | 'list';
  folder: DocumentFolder;
  folders: DocumentFolder[];
  documents: Array<{ folderId?: string | null }>;
  motion: RowMotion;
  onOpen: () => void;
  onRename: (name: string) => void;
  onMove: () => void;
  onDelete: () => void;
  onDropDocument: (docKey: string, folderId: string | null) => void;
}) {
  const drop = useDocumentDrop(folder.id, onDropDocument);
  const rename = async () => {
    const name = await dialog.prompt({ title: 'Rename folder', defaultValue: folder.name, confirmLabel: 'Rename' });
    if (name?.trim() && name.trim() !== folder.name) onRename(name.trim());
  };
  const rowMenu = useRowContextMenu(() => ({
    title: folder.name,
    kind: 'Folder',
    actions: [
      { id: 'open', label: 'Open', group: 'open', icon: 'open', run: onOpen },
      { id: 'move', label: 'Move to folder', group: 'set', icon: 'move', run: onMove },
      { id: 'rename', label: 'Rename', group: 'edit', icon: 'edit', run: () => void rename() },
      { id: 'delete', label: 'Delete folder', group: 'danger', icon: 'delete', danger: true, run: onDelete },
    ],
  }));

  return (
    <ListItem
      onClick={(e) => {
        if (e.currentTarget.contains(e.target as Node)) onOpen();
      }}
      onContextMenu={rowMenu.onContextMenu}
      {...drop.handlers}
      className={cn('cursor-pointer gap-3', layout === 'table' ? 'px-3 py-2.5' : 'px-3.5 py-3', drop.over && 'bg-accent', rowMotionClass(motion))}
    >
      {rowMenu.menu}
      <ListItemLeading>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Folder />
        </span>
      </ListItemLeading>
      <ListItemContent className="gap-0.5">
        <span
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen();
            }
          }}
          className="block w-full min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ListItemTitle>{folder.name}</ListItemTitle>
        </span>
        <p className="truncate text-xs tabular-nums text-muted-foreground">{folderContentsLabel(folders, documents, folder.id)}</p>
      </ListItemContent>
      {layout === 'table' && (
        <>
          <span className={cn(DOC_TABLE_COLUMNS.type, 'text-xs text-muted-foreground')}>Folder</span>
          <span className={DOC_TABLE_COLUMNS.expires} />
          <span className={DOC_TABLE_COLUMNS.added} />
        </>
      )}
      <span className={cn(DOC_TABLE_COLUMNS.menu, 'flex')}>
        <button
          type="button"
          aria-label={`${folder.name} actions`}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            rowMenu.openAt(r.right, r.bottom);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </span>
    </ListItem>
  );
}
