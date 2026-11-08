// A module helper's brief (core module-helpers.ts): what needs a decision
// today, as rows that act at once, with no AI. A suggested row (a missing
// ingredient) adds with its +; an item row with an action (running low)
// goes back on the list with its +; the section's header link does every
// row. Rows leave as they are done, because the brief is read live from the
// stores. Under it, the helper's catch-up ask leads its starters, which send as asks.
// Web twin: apps/web/src/app/assistant/helper-brief.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Plus, Sparkles } from 'lucide-react-native';
import { ArriveScope, ArriveView, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, Text, cn, haptics, toast } from '@homeup/ui';
import { moduleHelper, useHelperBrief, type BriefRow, type BriefSection } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

function BriefLine({ row, onAdd, onAct }: { row: BriefRow; onAdd: (key: string) => void; onAct: (id: string) => void }) {
  const actionable = row.kind === 'suggest' || !!row.action;
  const label = row.kind === 'suggest' ? `Add ${row.title}` : `Put ${row.title} back on the list`;
  return (
    <ListItem className={cn('items-center gap-3', actionable && 'bg-muted/30')}>
      {actionable ? (
        <Pressable
          onPress={() => {
            haptics.commit();
            if (row.kind === 'suggest') onAdd(row.key);
            else onAct(row.id);
          }}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-dashed border-primary/60 active:bg-primary/10"
        >
          <Plus size={16} className="text-primary" />
        </Pressable>
      ) : (
        <View className="h-9 w-9" />
      )}
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{row.title}</ListItemTitle>
        {row.meta ? (
          <ListItemMeta>
            <Text className="text-caption text-muted-foreground">{row.meta}</Text>
          </ListItemMeta>
        ) : null}
      </ListItemContent>
      {row.kind === 'item' && row.trailing ? (
        <ListItemTrailing className="mt-0">
          <Text className={cn('text-xs tabular-nums', row.warn ? 'font-medium text-warning' : 'text-muted-foreground')}>{row.trailing}</Text>
        </ListItemTrailing>
      ) : null}
    </ListItem>
  );
}

export function HelperBrief({ helper, onAsk, disabled }: { helper: string; onAsk: (text: string) => void; disabled: boolean }) {
  const { group, currentUserId } = useDataCache();
  const state = useHelperBrief({ helper, groupId: group?.id, currentUserId });
  const def = moduleHelper(helper);
  if (!def) return null;
  const brief = state?.brief;
  const doAll = (section: BriefSection) => {
    haptics.commit();
    const n = state?.all(section) ?? 0;
    if (n > 0) toast.success(section.id === 'dinners' ? `Added ${n} to the list` : `Put ${n} back on the list`);
  };
  return (
    <ArriveScope>
      <View className="gap-3">
        <ArriveView className="gap-1.5 px-0.5 pt-1">
          <Text className="font-heading text-[26px] font-bold leading-tight text-foreground">{brief?.title ?? def.label}</Text>
          {brief ? <Text className="text-sm leading-snug text-muted-foreground">{brief.lede}</Text> : null}
        </ArriveView>
        {brief?.sections.map((section) => (
          <ArriveView key={section.id} className="gap-2">
            <View className="flex-row items-center gap-2 px-1">
              <Text className="flex-1 text-micro-label uppercase text-muted-foreground">{section.title}</Text>
              {section.allLabel ? (
                <Pressable onPress={() => doAll(section)} accessibilityRole="button" hitSlop={10}>
                  <Text className="text-xs font-semibold text-primary">{section.allLabel}</Text>
                </Pressable>
              ) : null}
            </View>
            <ListGroup>
              {section.rows.map((row) => (
                <BriefLine key={row.kind === 'suggest' ? `s:${row.key}` : row.id} row={row} onAdd={(k) => state?.add(k)} onAct={(id) => state?.act(id)} />
              ))}
            </ListGroup>
          </ArriveView>
        ))}
        <ArriveView className="flex-row flex-wrap gap-1.5 pt-1">
          <Pressable
            disabled={disabled}
            onPress={() => {
              haptics.select();
              onAsk(def.summary.ask);
            }}
            accessibilityRole="button"
            className={cn('flex-row items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 active:bg-primary/15', disabled && 'opacity-50')}
          >
            <Sparkles size={14} className="text-primary" />
            <Text className="text-xs font-semibold text-primary">{def.summary.label}</Text>
          </Pressable>
          {def.starters.map((text) => (
            <Pressable
              key={text}
              disabled={disabled}
              onPress={() => {
                haptics.select();
                onAsk(text);
              }}
              accessibilityRole="button"
              className={cn('rounded-full border border-border bg-card px-3 py-1.5 active:bg-muted', disabled && 'opacity-50')}
            >
              <Text className="text-xs text-foreground">{text}</Text>
            </Pressable>
          ))}
        </ArriveView>
      </View>
    </ArriveScope>
  );
}
