'use client';

// The Checklists list row, shared by the Checklists page and the capture
// sheet's search results (so a checklist hit is the same line item, not a
// lookalike). Moved from apps/web/src/app/checklists/page.tsx.
// Native twin: apps/mobile/src/features/checklists/checklist-row.tsx.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, RotateCcw, Check } from 'lucide-react';
import { typeMeta, completion, type Checklist, type ChecklistTaskItem } from '@homeup/core';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { ListItem, ListItemContent, ListItemTitle, ListItemMeta, ListItemTrailing } from '@/components/ui/list-item';
import { LeadingTile } from '@/components/ui/leading-tile';
import { cn } from '@/lib/utils';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { checklistTypeIcon, scheduledDateMeta, SCHEDULED_TONE_CLASS, InlineMeter } from './checklist-ui';

export function ChecklistRow({
  list,
  items,
  onStartAgain,
  onNavigate,
  onSetDone,
  onDelete,
}: {
  list: Checklist;
  items: ChecklistTaskItem[];
  onStartAgain?: () => void;
  /** Marks the list finished, or reopens a finished one. Omit and the menu leaves it out. */
  onSetDone?: (done: boolean) => void;
  /** Deletes the list (the caller confirms). Omit and the menu leaves it out. */
  onDelete?: () => void;
  /** Runs before the descend navigation, e.g. the capture sheet closing itself. */
  onNavigate?: () => void;
}) {
  const meta = typeMeta(list.type);
  const { done, total, complete } = completion(items);
  const router = useRouter();
  const href = `/checklists/${list.id}`;
  const date = list.scheduled_date && !list.completed_at ? scheduledDateMeta(list.scheduled_date) : null;
  const open = () => {
    onNavigate?.();
    router.push(href);
  };

  // Hearth §13.7 "Row menu": right-click with a mouse.
  const rowMenu = useRowContextMenu(() => ({
    title: list.title,
    kind: 'Checklist',
    actions: [
      { id: 'open', label: 'Open', group: 'open', icon: 'open', run: open },
      onSetDone && {
        id: 'done',
        label: list.completed_at ? 'Reopen' : 'Mark complete',
        group: 'state',
        icon: list.completed_at ? 'undo' : 'done',
        run: () => onSetDone(!list.completed_at),
      },
      onStartAgain && { id: 'again', label: 'Start again', group: 'state', icon: 'repeat', run: onStartAgain },
      {
        id: 'copy',
        label: 'Copy link',
        group: 'share',
        icon: 'copy',
        run: () => void navigator.clipboard?.writeText(new URL(href, window.location.href).toString()),
      },
      onDelete && { id: 'delete', label: 'Delete', group: 'danger', icon: 'delete', danger: true, run: onDelete },
    ],
  }));

  return (
    <ListItem onContextMenu={rowMenu.onContextMenu}>
      {rowMenu.menu}
      {/* Hearth §8.1: descend — destination slides in from the right, this
          list draws back ~30% + dims. */}
      <Link
        href={href}
        onClick={(e) => {
          onNavigate?.();
          navLinkClickHandler('descend', router, href)(e);
        }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {/* v2 line item: the section tile leads, holding the type's glyph; a
            finished list swaps it for a check on the same tile. */}
        <LeadingTile sectionId="checklists" Icon={complete ? Check : checklistTypeIcon(list.type)} size="md" />
        <ListItemContent>
          <ListItemTitle>
            <span className={cn('truncate', list.completed_at ? 'text-muted-foreground' : 'text-foreground')}>
              {list.title}
            </span>
          </ListItemTitle>
          {/* Meta fragments, no pills: type word (Plain is silence), the
              relative date, then the count with its local meter. */}
          <ListItemMeta className="gap-x-2.5">
            {list.type !== 'plain' && <span>{meta.label}</span>}
            {date && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className={cn(date.tone !== 'muted' && 'font-medium', SCHEDULED_TONE_CLASS[date.tone])}>
                  {date.label}
                </span>
              </span>
            )}
            {total > 0 ? (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                {done}/{total}
                <InlineMeter done={done} total={total} />
              </span>
            ) : (
              <span>No items</span>
            )}
          </ListItemMeta>
        </ListItemContent>
      </Link>
      {onStartAgain && (
        <ListItemTrailing>
          <button
            type="button"
            onClick={onStartAgain}
            className="relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-foreground hover:bg-accent after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Start again
          </button>
        </ListItemTrailing>
      )}
    </ListItem>
  );
}
