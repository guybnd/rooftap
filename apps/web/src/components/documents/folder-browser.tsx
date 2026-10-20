'use client';

// Folder chrome for the Documents section: the folder path over the lede,
// section labels, and folder tiles. Folders are tiles in a grid under their
// own "Folders" label and documents stay line items in one card under
// "Files", so a folder never reads as just another row. Native twin:
// apps/mobile/src/components/documents/folder-ui.tsx.

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Folder, FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { PopMenu, MenuItem, MenuDivider } from '@/app/setup/pop-menu';
import { HoldFillOverlay } from '@/components/ui/hold-fill-overlay';
import { folderBreadcrumb, folderContentsLabel, type DocumentFolder } from '@homeup/core';
import { cn } from '@/lib/utils';
import { stopRow, useRowLongPress } from './use-row-long-press';

const MICRO_LABEL = 'text-[10.5px] font-semibold uppercase tracking-[0.1em]';

/**
 * The path to the open folder, as micro labels over the lede ("‹ Documents ›
 * Home"). Every crumb but the last climbs back up; the chevron in front says
 * the first one is a way back. Renders nothing at the top level, where the
 * top nav already names the section.
 */
export function FolderPath({
  folders,
  folderId,
  onNavigate,
}: {
  folders: DocumentFolder[];
  folderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  const path = folderBreadcrumb(folders, folderId);
  if (path.length === 0) return null;

  return (
    <nav aria-label="Folder path" className={cn('-ml-1.5 flex flex-wrap items-center gap-x-1', MICRO_LABEL)}>
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="flex min-h-11 items-center gap-0.5 rounded-lg px-1 uppercase text-muted-foreground transition-colors hover:text-foreground sm:min-h-8"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Documents
      </button>
      {path.map((f, i) => {
        const last = i === path.length - 1;
        return (
          <span key={f.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <button
              type="button"
              onClick={() => onNavigate(f.id)}
              disabled={last}
              aria-current={last ? 'location' : undefined}
              className={cn(
                'flex min-h-11 min-w-0 items-center rounded-lg px-1 uppercase transition-colors sm:min-h-8',
                last ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="truncate">{f.name}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export function NewFolderButton({ onCreate }: { onCreate: (name: string) => void }) {
  return (
    <button
      onClick={() => {
        const name = window.prompt('Folder name');
        if (name?.trim()) onCreate(name.trim());
      }}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:h-9"
    >
      <FolderPlus className="h-4 w-4" />
      New folder
    </button>
  );
}

/** A section label over the folder grid or a files card: micro label + count (Hearth §6 group header). */
export function DocumentsSectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <h2 className={cn('mb-2 flex items-baseline gap-2 px-1 text-muted-foreground', MICRO_LABEL)}>
      {label}
      <span className="tabular-nums text-muted-foreground/60">{count}</span>
    </h2>
  );
}

/**
 * One folder as a tile in the grid: its own card (H4: sibling cards, never a
 * card in a card), a folder glyph on a neutral inset tile (a container is not
 * state or identity, so no hue, H2), the name, and one line of what it holds.
 * Click opens it; hold (touch), right-click, or the "more" button opens its
 * actions, the same paths a document row has.
 */
export function FolderTile({
  folder,
  folders,
  documents,
  onOpen,
  onRename,
  onMove,
  onDelete,
  motion = 'idle',
}: {
  folder: DocumentFolder;
  folders: DocumentFolder[];
  documents: Array<{ folderId?: string | null }>;
  onOpen: () => void;
  onRename: (name: string) => void;
  onMove: () => void;
  onDelete: () => void;
  motion?: RowMotion;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const longPress = useRowLongPress(() => setMenuOpen(true));
  const contents = folderContentsLabel(folders, documents, folder.id);

  return (
    <div
      // Clicks from the portalled menu bubble here through React's tree;
      // only a click on the tile itself opens the folder.
      onClick={(e) => {
        if (e.currentTarget.contains(e.target as Node)) onOpen();
      }}
      {...longPress.handlers}
      className={cn(
        'group relative flex min-h-[112px] cursor-pointer select-none flex-col overflow-hidden rounded-3xl border border-border/60 bg-card p-3.5 shadow-[var(--card-shadow)] hover:border-border [-webkit-touch-callout:none]',
        rowMotionClass(motion)
      )}
    >
      <HoldFillOverlay progress={longPress.progress} />
      <div className="relative z-10 flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Folder className="h-5 w-5" />
        </span>
        <span {...stopRow}>
          <PopMenu
            align="right"
            triggerClassName="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9 sm:-mr-1.5 sm:-mt-1.5"
            triggerLabel={`${folder.name} actions`}
            trigger={<MoreHorizontal className="h-4 w-4" />}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            mobileSheet
            previewContent={
              <>
                <Folder className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{folder.name}</span>
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    const name = window.prompt('Rename folder', folder.name);
                    if (name?.trim() && name.trim() !== folder.name) onRename(name.trim());
                  }}
                >
                  Rename
                </MenuItem>
                <MenuItem
                  icon={<FolderInput className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    onMove();
                  }}
                >
                  Move to folder
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  danger
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                >
                  Delete folder
                </MenuItem>
              </>
            )}
          </PopMenu>
        </span>
      </div>
      {/* The keyboard path into the folder (a pointer clicks the tile). Not a
          <button>: a hold that starts on the name must still open the menu,
          and the long-press skips buttons. */}
      <span
        role="button"
        tabIndex={0}
        aria-label={`${folder.name}, folder, ${contents}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className="relative z-10 mt-auto block min-w-0 rounded-sm pt-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="line-clamp-2 text-sm font-medium text-foreground">{folder.name}</span>
        <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">{contents}</span>
      </span>
    </div>
  );
}

/** Where a row is in the "filed into a folder" choreography. */
export type RowMotion = 'idle' | 'leaving' | 'receiving';

/** How long a filed row takes to leave before the data changes (Hearth MO settle). */
export const ROW_LEAVE_MS = 240;

/**
 * The filing choreography as classes on a row or folder tile. Leaving: it
 * shrinks, lifts toward the folders at the top and fades at settle with an
 * ease-in. Receiving: the folder tile swells slightly and washes, then eases back. Transform,
 * opacity and a background wash only, on the --motion-* tokens, which
 * prefers-reduced-motion collapses to 0ms.
 */
export function rowMotionClass(motion: RowMotion): string {
  return cn(
    'transition-[opacity,transform,background-color]',
    motion === 'leaving'
      ? 'pointer-events-none -translate-y-3 scale-[0.96] opacity-0 duration-[var(--motion-settle)] ease-[var(--motion-ease-in)]'
      : 'duration-[var(--motion-exit)] ease-[var(--motion-ease-out)]',
    motion === 'receiving' && 'scale-[1.015] bg-accent/60 duration-[var(--motion-fast)]'
  );
}
