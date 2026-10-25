'use client';

// Folder chrome for the Documents section: the folder path over the lede,
// section labels and the filing choreography. Folders are rows in their own
// card under a "Folders" label (FolderTableRow in folder-tree.tsx) and
// documents follow in one card under "Files". Native twin:
// apps/mobile/src/components/documents/folder-ui.tsx.

import { ChevronLeft, ChevronRight, FolderPlus } from 'lucide-react';
import { folderBreadcrumb, type DocumentFolder } from '@homeup/core';
import { dialog } from '@homeup/core';
import { cn } from '@/lib/utils';

// Sentence case, not uppercase eyebrows (Guy, 2026-10-25).
const LABEL = 'text-xs font-medium';

/**
 * The path to the open folder, as small labels over the lede ("‹ Documents ›
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
    <nav aria-label="Folder path" className={cn('-ml-1.5 flex flex-wrap items-center gap-x-1', LABEL)}>
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="flex min-h-11 items-center gap-0.5 rounded-lg px-1 text-muted-foreground transition-colors hover:text-foreground sm:min-h-8"
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
                'flex min-h-11 min-w-0 items-center rounded-lg px-1 transition-colors sm:min-h-8',
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
      onClick={async () => {
        const name = await dialog.prompt({ title: 'New folder', placeholder: 'Folder name', confirmLabel: 'Create' });
        if (name?.trim()) onCreate(name.trim());
      }}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:h-9"
    >
      <FolderPlus className="h-4 w-4" />
      New folder
    </button>
  );
}

/** A section label over the folder grid or a files card: label + count (Hearth §6 group header). */
export function DocumentsSectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <h2 className={cn('mb-2 flex items-baseline gap-2 px-1 text-muted-foreground', LABEL)}>
      {label}
      <span className="tabular-nums text-muted-foreground/60">{count}</span>
    </h2>
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
