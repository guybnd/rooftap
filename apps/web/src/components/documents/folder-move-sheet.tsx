'use client';

// Where to file a document or folder, in one step. The destinations are the
// sheet's own rows, indented as a tree, so one tap moves it: no dropdown
// inside the sheet. The current location carries a check, and "New folder"
// names one inline and files the item straight into it. A bottom sheet per
// Hearth M4; past a handful of folders it grows a search field so a deep tree
// doesn't have to be scrolled.

import { useEffect, useMemo, useState } from 'react';
import { Check, Files, Folder, FolderPlus } from 'lucide-react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ListGroup,
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
} from '@/components/ui/list-item';
import { folderMoveOptions, type DocumentFolder } from '@homeup/core';
import { cn } from '@/lib/utils';

/** Above this many destinations the sheet grows a search field. */
const SEARCH_THRESHOLD = 8;

export function FolderMoveSheet({
  open,
  onOpenChange,
  folders,
  movingFolderId,
  currentFolderId,
  title,
  itemName,
  onSelect,
  onCreateAndMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: DocumentFolder[];
  /** The folder being moved, whose subtree is no destination; null for a document. */
  movingFolderId: string | null;
  /** Where the item sits now; undefined when several items sit in different places. */
  currentFolderId: string | null | undefined;
  title: string;
  itemName: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateAndMove: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  // Each opening starts clean, whatever the last one left behind.
  useEffect(() => {
    if (open) {
      setQuery('');
      setNaming(false);
      setName('');
    }
  }, [open]);

  const options = useMemo(() => folderMoveOptions(folders, movingFolderId), [folders, movingFolderId]);
  const q = query.trim().toLowerCase();
  const searching = q !== '';
  const visible = searching
    ? options.filter((o) => [...o.path, o.folder.name].join(' ').toLowerCase().includes(q))
    : options;

  const pick = (folderId: string | null) => {
    onOpenChange(false);
    if (folderId !== currentFolderId) onSelect(folderId);
  };

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onOpenChange(false);
    onCreateAndMove(trimmed);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="bg-black/40"
      // Same finish as PortalChip's overflow sheet on phones; a centred card
      // on desktop, like ItemFormSheet, rather than a full-width strip.
      className={cn(
        'rounded-t-2xl border-t border-border bg-popover/95 text-popover-foreground shadow-2xl shadow-black/50 backdrop-blur-xl',
        'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border'
      )}
      handleClassName="sm:hidden"
    >
      {(contentRef) => (
        <>
          <div className="px-4 pb-2 pt-1 sm:pt-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
            {itemName && <p className="truncate text-sm text-foreground">{itemName}</p>}
          </div>

          {options.length > SEARCH_THRESHOLD && (
            <div className="px-4 pb-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search folders"
                aria-label="Search folders"
              />
            </div>
          )}

          <div ref={contentRef} className="max-h-[50vh] overflow-y-auto px-1.5">
            <ListGroup className="border-0 bg-transparent shadow-none" role="list" aria-label={title}>
              {!searching && (
                <DestinationRow
                  name="All documents"
                  depth={0}
                  root
                  current={currentFolderId === null}
                  onPick={() => pick(null)}
                />
              )}
              {visible.map((o) => (
                <DestinationRow
                  key={o.folder.id}
                  name={o.folder.name}
                  depth={searching ? 0 : o.depth + 1}
                  path={searching && o.path.length > 0 ? o.path.join(' / ') : undefined}
                  current={o.folder.id === currentFolderId}
                  onPick={() => pick(o.folder.id)}
                />
              ))}
              {searching && visible.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground">No matching folder</p>
              )}
            </ListGroup>
          </div>

          <div className="mx-4 my-1 h-px bg-border" />
          {naming ? (
            <form
              className="flex items-center gap-2 px-4 pb-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Folder name"
                aria-label="Folder name"
                autoFocus
                className="flex-1"
              />
              <Button type="submit" disabled={name.trim() === ''}>
                Create and move
              </Button>
            </form>
          ) : (
            <div className="px-1.5">
              <ListItem asChild className="cursor-pointer rounded-lg hover:bg-muted/50">
                <button type="button" onClick={() => setNaming(true)} className="text-left">
                  <ListItemLeading>
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl">
                      <FolderPlus className="text-primary" />
                    </span>
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle className="text-primary">New folder</ListItemTitle>
                  </ListItemContent>
                </button>
              </ListItem>
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}

function DestinationRow({
  name,
  depth,
  path,
  root = false,
  current,
  onPick,
}: {
  name: string;
  depth: number;
  path?: string;
  root?: boolean;
  current: boolean;
  onPick: () => void;
}) {
  const Icon = root ? Files : Folder;
  return (
    <ListItem asChild className="cursor-pointer rounded-lg hover:bg-muted/50" role="listitem">
      <button
        type="button"
        onClick={onPick}
        aria-current={current ? 'location' : undefined}
        className="text-left"
        // Indent carries the tree; capped so a deep branch keeps its names.
        style={{ paddingLeft: 12 + Math.min(depth, 4) * 20 }}
      >
        {/* Neutral, like the folder rows on the page: the row is the
            control and the check marks where it is now (H2). */}
        <ListItemLeading>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon />
          </span>
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle>{name}</ListItemTitle>
          {path && <ListItemMeta>{path}</ListItemMeta>}
        </ListItemContent>
        {current && (
          <ListItemTrailing>
            <Check className="h-4 w-4 text-primary" />
          </ListItemTrailing>
        )}
      </button>
    </ListItem>
  );
}
