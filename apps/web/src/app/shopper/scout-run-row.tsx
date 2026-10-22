'use client';

// HOUP-435: one Scout search as a §6 row, on Shopper and in its Archived
// list. Right-click (Hearth §13.7 "Row menu") opens it, archives it or moves
// it back, and deletes it with Undo. A search is the household's, so this
// changes it for everyone. Native twin: apps/mobile/src/features/shopper/scout-run-row.tsx.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import {
  archiveScoutRun,
  deleteScoutRun,
  scoutRunStatus,
  scoutTitle,
  timeAgo,
  unarchiveScoutRun,
  useModules,
  type ShopperSearch,
} from '@homeup/core';
import { archiveToast } from '@/lib/archive-toast';
import { updateScoutRun } from '@/lib/shopper-api';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListItem, ListItemContent, ListItemMeta, ListItemTitle } from '@/components/ui/list-item';

export function ScoutRunRow({ run, onChanged }: { run: ShopperSearch; onChanged?: () => void }) {
  const router = useRouter();
  const canArchive = useModules().server('shopper.scout-archive');
  const href = `/shopper/scout/${run.id}`;
  const status = scoutRunStatus(run);
  const meta =
    status === 'running' ? 'Researching…' : status === 'failed' ? "Didn't finish" : [timeAgo(run.finished_at ?? run.created_at)].filter(Boolean).join(' · ');
  const rowMenu = useRowContextMenu(() => ({
    title: scoutTitle(run.brief),
    kind: 'Scout search',
    actions: [
      { id: 'open', label: 'Open', group: 'open', icon: 'open', run: () => router.push(href) },
      canArchive &&
        status !== 'running' && {
          id: 'archive',
          label: run.archived_at ? 'Move back to Shopper' : 'Archive',
          group: 'set',
          icon: 'archive',
          run: () => void (run.archived_at ? unarchiveScoutRun : archiveScoutRun)(updateScoutRun, run.id, archiveToast, onChanged),
        },
      canArchive &&
        status !== 'running' && {
          id: 'delete',
          label: 'Delete',
          group: 'danger',
          icon: 'delete',
          danger: true,
          run: () => void deleteScoutRun(updateScoutRun, run.id, archiveToast, onChanged),
        },
    ],
  }));
  return (
    <>
      {rowMenu.menu}
      <ListItem asChild onContextMenu={rowMenu.onContextMenu}>
        <Link href={href} onClick={navLinkClickHandler('descend', router, href)}>
          <LeadingTile sectionId="shopper" Icon={Sparkles} size="md" />
          <ListItemContent>
            <ListItemTitle>
              <span className="truncate">{scoutTitle(run.brief)}</span>
            </ListItemTitle>
            <ListItemMeta>
              <span>{meta}</span>
            </ListItemMeta>
          </ListItemContent>
        </Link>
      </ListItem>
    </>
  );
}
