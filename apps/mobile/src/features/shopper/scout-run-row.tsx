// HOUP-435: one Scout search as a §6 row, on Shopper and in its Archived
// list. Swipe right archives it (or moves an archived one back), swipe left
// deletes it with Undo. A search is the household's, so this changes it for
// everyone. Web twin: apps/web/src/app/shopper/scout-run-row.tsx.
import * as React from 'react';
import { Archive, ArchiveRestore, Sparkles, Trash2 } from 'lucide-react-native';
import { LeadingTile, ListItem, ListItemContent, ListItemMeta, ListItemTitle, SwipeActions, Text, haptics } from '@homeup/ui';
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
import { updateScoutRun } from '@/features/shopper/shopper-api';

export function ScoutRunRow({ run, onPress, onChanged }: { run: ShopperSearch; onPress: () => void; onChanged?: () => void }) {
  const canArchive = useModules().server('shopper.scout-archive');
  const status = scoutRunStatus(run);
  const meta = status === 'running' ? 'Researching…' : status === 'failed' ? "Didn't finish" : timeAgo(run.finished_at ?? run.created_at) ?? '';
  const row = (
    <ListItem onPress={onPress} accessibilityRole="button">
      <LeadingTile sectionId="shopper" Icon={Sparkles} size="md" />
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{scoutTitle(run.brief)}</ListItemTitle>
        <ListItemMeta>
          <Text numberOfLines={1} className="text-caption text-muted-foreground">
            {meta}
          </Text>
        </ListItemMeta>
      </ListItemContent>
    </ListItem>
  );
  // A search still researching finishes first.
  if (!canArchive || status === 'running') return row;
  const archived = !!run.archived_at;
  return (
    <SwipeActions
      onSwipeRight={() => void (archived ? unarchiveScoutRun : archiveScoutRun)(updateScoutRun, run.id, archiveToast, onChanged)}
      onSwipeLeft={() => {
        haptics.remove();
        void deleteScoutRun(updateScoutRun, run.id, archiveToast, onChanged);
      }}
      right={{
        bg: 'bg-muted',
        activeBg: 'bg-foreground/15',
        icon: archived ? <ArchiveRestore size={18} className="text-foreground" /> : <Archive size={18} className="text-foreground" />,
        label: archived ? 'Move back' : 'Archive',
      }}
      left={{
        bg: 'bg-destructive/15',
        activeBg: 'bg-destructive',
        icon: <Trash2 size={18} className="text-destructive" />,
        label: 'Delete',
      }}
    >
      {row}
    </SwipeActions>
  );
}
