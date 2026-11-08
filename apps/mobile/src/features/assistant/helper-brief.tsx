// A module helper's brief (core module-helpers.ts): what needs a decision
// today, as rows that act at once, with no AI. Rows that already exist
// (running low, use soon) are their module's own rows, the same ones the
// chat's answers show, plus "Not now"; a suggested row (a missing
// ingredient) adds with its + or a swipe, and swipes away as "Have it". The
// section's header link does every row. Long sections fold under Show all. Rows leave as they are done, because the brief is read live from the
// stores. The helper's asks (HelperAskChips) sit above the text box, not in the chat.
// Web twin: apps/web/src/app/assistant/helper-brief.tsx.
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { ArriveScope, ArriveView, ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, Text, cn, haptics, toast } from '@homeup/ui';
import { useOpenRoute } from '@/lib/tab-routes';
import {
  SHOWN_ITEMS_FOLD,
  briefItemIds,
  moduleHelper,
  useHelperBrief,
  type AssistantShown,
  type BriefRow,
  type BriefSection,
  type HelperBriefState,
} from '@homeup/core';
import { ChatChanges, SuggestLine } from './chat-changes';
import { useDataCache } from '@/lib/data-cache';

/** A row that is a fact (a night, an occasion): its line, opening its screen. */
function InfoLine({ row }: { row: Extract<BriefRow, { kind: 'item' }> }) {
  const openRoute = useOpenRoute();
  return (
    <ListItem
      className="items-center gap-3"
      onPress={row.href ? () => openRoute(row.href!) : undefined}
      accessibilityRole={row.href ? 'link' : undefined}
    >
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{row.title}</ListItemTitle>
        {row.meta ? (
          <ListItemMeta>
            <Text className="text-caption text-muted-foreground">{row.meta}</Text>
          </ListItemMeta>
        ) : null}
      </ListItemContent>
      {row.trailing ? (
        <ListItemTrailing className="mt-0">
          <Text className={cn('text-xs', row.warn ? 'font-medium text-warning' : 'text-muted-foreground')} style={{ fontVariant: ['tabular-nums'] }}>
            {row.trailing}
          </Text>
        </ListItemTrailing>
      ) : null}
    </ListItem>
  );
}

function SuggestSection({ section, state }: { section: BriefSection; state: HelperBriefState | null }) {
  const [all, setAll] = React.useState(false);
  const rows = all ? section.rows : section.rows.slice(0, SHOWN_ITEMS_FOLD);
  const hidden = section.rows.length - rows.length;
  return (
    <ListGroup>
      {rows.map((row) =>
        row.kind === 'item' && !row.action ? (
          <InfoLine key={row.id} row={row} />
        ) : (
        <SuggestLine
          key={row.kind === 'suggest' ? `s:${row.key}` : row.id}
          title={row.title}
          meta={row.meta}
          dismissLabel={section.dismissLabel ?? null}
          onAdd={() => (row.kind === 'suggest' ? state?.add(row.key) : state?.act(row.id))}
          onDismiss={() => state?.dismiss(row)}
        />
        )
      )}
      {hidden > 0 ? (
        <ListItem className="items-center justify-center" onPress={() => setAll(true)} accessibilityRole="button">
          <Text className="text-sm font-medium text-foreground">Show all {section.rows.length}</Text>
        </ListItem>
      ) : null}
    </ListGroup>
  );
}

export function HelperBrief({ helper }: { helper: string }) {
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
            {section.module ? (
              // Rows that already exist: the module's own row, as in the chat's answers, with the brief's action and dismiss.
              <ChatChanges
                changes={undefined}
                shown={[{ title: section.title, module: section.module as AssistantShown['module'], ids: briefItemIds(section) }]}
                extras={{
                  action: () => (section.allLabel ? { label: section.allLabel, run: () => doAll(section) } : null),
                  rowExtra: (_, id) => {
                    const row = section.rows.find((r) => r.kind === 'item' && r.id === id);
                    return {
                      needAgain: row?.kind === 'item' && !!row.action,
                      onNotNow: section.dismissLabel && row ? () => state?.dismiss(row) : undefined,
                    };
                  },
                }}
              />
            ) : (
              <>
                <View className="flex-row items-center gap-2 px-1">
                  <Text className="flex-1 text-micro-label uppercase text-muted-foreground">{section.title}</Text>
                  {section.allLabel ? (
                    <Pressable onPress={() => doAll(section)} accessibilityRole="button" hitSlop={10}>
                      <Text className="text-xs font-semibold text-primary">{section.allLabel}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <SuggestSection section={section} state={state ?? null} />
              </>
            )}
          </ArriveView>
        ))}
      </View>
    </ArriveScope>
  );
}

/**
 * The helper's asks: its catch-up first, then its starters, each sent as it
 * is. They sit in a row just above the text box while the brief is on show,
 * so they are in reach however long the brief is.
 */
export function HelperAskChips({ helper, onAsk, disabled }: { helper: string; onAsk: (text: string) => void; disabled: boolean }) {
  const def = moduleHelper(helper);
  if (!def) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" className="-mx-4" contentContainerClassName="gap-1.5 px-4">
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
    </ScrollView>
  );
}
