// The Checklists list row, shared by the Checklists screen and the capture
// sheet's search results (so a checklist hit is the same line item, not a
// lookalike). Moved verbatim from apps/mobile/src/app/(tabs)/checklists/index.tsx.
// Web twin: apps/web/src/app/checklists/checklist-row.tsx.
import { View } from 'react-native';
import { CalendarDays, Check, RotateCcw } from 'lucide-react-native';
import {
  Text,
  Button,
  LeadingTile,
  ListItem,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  cn,
} from '@homeup/ui';
import { completion, typeMeta, type Checklist, type ChecklistTaskItem } from '@homeup/core';
import { checklistTypeIcon, scheduledDateMeta, SCHEDULED_TONE_CLASS, InlineMeter } from './checklist-ui';

export function ChecklistRow({
  list,
  items,
  onPress,
  onStartAgain,
}: {
  list: Checklist;
  items: ChecklistTaskItem[];
  onPress: () => void;
  onStartAgain?: () => void;
}) {
  const meta = typeMeta(list.type);
  const { done, total, complete } = completion(items);
  // H6: relative date (web's checklist-ui grammar); a finished run drops it.
  const date = list.scheduled_date && !list.completed_at ? scheduledDateMeta(list.scheduled_date) : null;

  return (
    <ListItem onPress={onPress}>
      {/* v2 line item: the section tile leads, holding the type's Lucide
          glyph (no emoji in chrome); a finished list swaps it for a check. */}
      <LeadingTile sectionId="checklists" Icon={complete ? Check : checklistTypeIcon(list.type)} size="md" />
      <ListItemContent>
        <ListItemTitle className={list.completed_at ? 'text-muted-foreground' : 'text-foreground'}>{list.title}</ListItemTitle>
        {/* Meta fragments in one wrapping run (no auto dots): the type word
            (Plain is silence), the relative date, the count with its meter. */}
        <ListItemMeta>
          <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {list.type !== 'plain' && <Text className="text-caption text-muted-foreground">{meta.label}</Text>}
            {date && (
              <View className="flex-row items-center gap-1">
                <CalendarDays size={13} className="text-muted-foreground" />
                <Text
                  className={cn('text-caption', date.tone !== 'muted' && 'font-medium', SCHEDULED_TONE_CLASS[date.tone])}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {date.label}
                </Text>
              </View>
            )}
            {total > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {done}/{total}
                </Text>
                <InlineMeter done={done} total={total} />
              </View>
            ) : (
              <Text className="text-caption text-muted-foreground">No items</Text>
            )}
          </View>
        </ListItemMeta>
      </ListItemContent>
      {onStartAgain && (
        <ListItemTrailing>
          <Button
            size="sm"
            variant="outline"
            accessibilityLabel="Start again"
            hitSlop={4}
            onPress={(e) => {
              e.stopPropagation();
              onStartAgain();
            }}
          >
            <RotateCcw size={13} className="text-foreground" />
            <Text className="text-xs font-medium text-foreground">Start again</Text>
          </Button>
        </ListItemTrailing>
      )}
    </ListItem>
  );
}
