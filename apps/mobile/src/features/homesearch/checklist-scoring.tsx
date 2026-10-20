// HOUP-78: native port of apps/web/src/components/checklist-scoring.tsx —
// per-apartment scoring against the group's checklist: overall ScoreBadge,
// progress bar, category-grouped items, tap-to-cycle response
// null -> true -> false -> null, dealbreaker/bonus badges, weight bars.
//
// Reads/writes apartmentChecklistResponses$ through Legend exactly like the
// web original, including its revive-soft-deleted-row logic: syncResponse
// looks an existing response row up by (unfiltered-by-deleted) id and
// patches `{ value, deleted: false }` instead of writing a fresh row, so the
// DB's (apartment_id, checklist_item_id) unique constraint isn't violated
// when a previously-cleared answer is set again.
//
// The web original's pointer-drag swipe-left/right (set true/false directly)
// has no native equivalent worth the gesture-handler/ScrollView conflict
// risk inside a parent scroll — dropped in favor of tap-to-cycle alone,
// which already reaches every state (null -> true -> false -> null).
//
// Hearth v2 pass (mirrors web): Title-step heading; the answered count is a
// caption with a local 52px meter (H3: no edge-to-edge status bars); each
// category is a micro label with its pass count and local meter over one
// ListGroup; an item's type is a meta word ("Dealbreaker", "Bonus"; required
// is the silent default) instead of a 0.65rem chip (T4, PC1); state is the
// glyph's tint, never a row fill.
import * as React from 'react';
import { View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { AlertTriangle, CheckCircle2, Circle, ClipboardCheck, ShieldAlert, Sparkles, XCircle } from 'lucide-react-native';
import {
  Text,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemTitle,
  ListItemTrailing,
  cn,
} from '@homeup/ui';
import {
  apartmentChecklistResponses$,
  calculateScore,
  useReconnectSync,
  useStoreHelpers,
  type ChecklistItem,
  type ChecklistResponse,
} from '@homeup/core';
import { randomUUID } from '@/lib/uuid';
import { ScoreBadge } from './score-badge';

type ResponseValue = boolean | null;

export interface ChecklistScoringProps {
  apartmentId: string;
  items: ChecklistItem[];
}

export function ChecklistScoring({ apartmentId, items }: ChecklistScoringProps) {
  const groupId = items[0]?.group_id;
  const responsesStore$ = apartmentChecklistResponses$(groupId);
  useReconnectSync(responsesStore$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(responsesStore$, null);

  // Includes soft-deleted rows — needed so syncResponse can revive one instead
  // of inserting a duplicate (apartment_id, checklist_item_id) row, which the
  // DB's unique constraint would reject.
  const allResponses = use$(() =>
    Object.values(responsesStore$.get() ?? {}).filter(
      (r): r is ChecklistResponse => !!r && r.apartment_id === apartmentId
    )
  );

  const responses = React.useMemo(() => {
    const map: Record<string, ResponseValue> = {};
    for (const r of allResponses) {
      if (!r.deleted) map[r.checklist_item_id] = r.value;
    }
    return map;
  }, [allResponses]);

  const score = React.useMemo(() => {
    const hasAny = Object.values(responses).some((v) => v !== undefined);
    if (!hasAny) return null;
    return calculateScore(items, responses);
  }, [items, responses]);

  const categories = React.useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of [...items].sort((a, b) => a.order - b.order)) {
      const cat = item.category || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return map;
  }, [items]);

  const progress = React.useMemo(() => {
    const answered = items.filter((i) => responses[i.id] !== undefined && responses[i.id] !== null).length;
    return { answered, total: items.length, percent: items.length > 0 ? Math.round((answered / items.length) * 100) : 0 };
  }, [items, responses]);

  const syncResponse = React.useCallback(
    (itemId: string, value: ResponseValue) => {
      if (!groupId) return;
      // Look up by id (not filtered by deleted) — reviving a soft-deleted row
      // via patchRow avoids violating the (apartment_id, checklist_item_id)
      // unique constraint that a fresh writeRow would hit.
      const existing = allResponses.find((r) => r.checklist_item_id === itemId);
      if (existing) {
        if (value === null) {
          softDeleteRow(existing.id);
        } else {
          patchRow(existing.id, { value, deleted: false });
        }
      } else if (value !== null) {
        writeRow({
          id: randomUUID(),
          group_id: groupId,
          apartment_id: apartmentId,
          checklist_item_id: itemId,
          value,
          notes: null,
          deleted: false,
          created_at: null as unknown as string,
          updated_at: null as unknown as string,
        } as ChecklistResponse);
      }
    },
    [groupId, apartmentId, allResponses, writeRow, patchRow, softDeleteRow]
  );

  const cycleValue = React.useCallback(
    (itemId: string) => {
      const current = responses[itemId];
      let next: ResponseValue;
      if (current === undefined || current === null) next = true;
      else if (current === true) next = false;
      else next = null;
      syncResponse(itemId, next);
    },
    [responses, syncResponse]
  );

  const isDealbreaker = (itemId: string) => score?.dealbreakers.includes(itemId) ?? false;

  if (items.length === 0) {
    return (
      <View className="items-center py-8">
        <Text className="text-center text-sm text-muted-foreground">
          No checklist items yet. Add items in the Checklist page to start scoring.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className="gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            <ClipboardCheck size={16} className="text-muted-foreground" />
            <Text className="text-title text-foreground">Checklist</Text>
          </View>
          {score && (
            <View className="flex-row items-center gap-3">
              {score.dealbreakers.length > 0 && (
                <View className="flex-row items-center gap-1">
                  <AlertTriangle size={14} className="text-destructive" />
                  <Text className="text-xs font-medium text-destructive">
                    {score.dealbreakers.length === 1 ? 'Dealbreaker' : `${score.dealbreakers.length} dealbreakers`}
                  </Text>
                </View>
              )}
              <ScoreBadge percentage={score.percentage} hasDealbreakers={score.dealbreakers.length > 0} size="sm" />
            </View>
          )}
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {progress.answered} of {progress.total} answered
          </Text>
          <LocalMeter percent={progress.percent} fillClassName="bg-success" />
        </View>
      </View>

      <View className="gap-5">
        {Array.from(categories.entries()).map(([category, categoryItems]) => {
          const catAnswered = categoryItems.filter((i) => responses[i.id] !== undefined && responses[i.id] !== null).length;
          const catYes = categoryItems.filter((i) => responses[i.id] === true).length;
          const catPercent = catAnswered > 0 ? Math.round((catYes / catAnswered) * 100) : 0;

          const fillClassName = catPercent >= 80 ? 'bg-success' : catPercent >= 60 ? 'bg-warning' : 'bg-destructive';

          return (
            <View key={category} className="gap-2">
              <View className="flex-row items-center justify-between gap-2 px-1">
                <Text className="text-micro-label uppercase text-muted-foreground">{category}</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    {catYes} of {categoryItems.length} pass
                  </Text>
                  <LocalMeter
                    percent={catAnswered > 0 ? (catYes / categoryItems.length) * 100 : 0}
                    fillClassName={fillClassName}
                  />
                </View>
              </View>

              <ListGroup>
                {categoryItems.map((item) => {
                  const value = responses[item.id];
                  const triggered = isDealbreaker(item.id);
                  return (
                    <ListItem
                      key={item.id}
                      onPress={() => cycleValue(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.label}: ${value === true ? 'yes' : value === false ? 'no' : 'unanswered'}`}
                    >
                      <ListItemLeading>
                        <ResponseIcon value={value} triggered={triggered} />
                      </ListItemLeading>

                      <ListItemContent>
                        <ListItemTitle
                          className={cn(
                            triggered && 'text-destructive',
                            (value === null || value === undefined) && 'text-muted-foreground'
                          )}
                        >
                          {item.label}
                        </ListItemTitle>
                        <ItemTypeMeta item={item} triggered={triggered} />
                      </ListItemContent>

                      <ListItemTrailing className="gap-2">
                        <LocalMeter
                          percent={(item.weight / 10) * 100}
                          fillClassName={triggered ? 'bg-destructive' : value === true ? 'bg-success' : 'bg-foreground/30'}
                        />
                        <Text className="w-4 text-right text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                          {item.weight}
                        </Text>
                      </ListItemTrailing>
                    </ListItem>
                  );
                })}
              </ListGroup>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** H3: a local meter, ~52px inline and 3px tall. */
function LocalMeter({ percent, fillClassName }: { percent: number; fillClassName: string }) {
  return (
    <View className="h-[3px] w-[52px] overflow-hidden rounded-full bg-muted">
      <View
        className={cn('h-full rounded-full', fillClassName)}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </View>
  );
}

function ResponseIcon({ value, triggered }: { value: ResponseValue; triggered: boolean }) {
  if (value === true) return <CheckCircle2 size={18} className="text-success" />;
  if (value === false) return <XCircle size={18} className={triggered ? 'text-destructive' : 'text-muted-foreground'} />;
  return <Circle size={18} className="text-muted-foreground/40" />;
}

function ItemTypeMeta({ item, triggered }: { item: ChecklistItem; triggered: boolean }) {
  if (item.is_dealbreaker) {
    return (
      <View className="mt-0.5 flex-row items-center gap-1">
        <ShieldAlert size={12} className={triggered ? 'text-destructive' : 'text-muted-foreground'} />
        <Text className={cn('text-xs', triggered ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          Dealbreaker
        </Text>
      </View>
    );
  }
  if (item.is_bonus) {
    return (
      <View className="mt-0.5 flex-row items-center gap-1">
        <Sparkles size={12} className="text-muted-foreground" />
        <Text className="text-xs text-muted-foreground">Bonus</Text>
      </View>
    );
  }
  return null;
}
