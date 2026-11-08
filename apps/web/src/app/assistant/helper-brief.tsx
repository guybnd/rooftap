'use client';

// A module helper's brief (core module-helpers.ts): what needs a decision
// today, as rows that act at once, with no AI. Rows that already exist
// (running low, use soon) are their module's own rows, the same ones the
// chat's answers show, plus "Not now"; a suggested row (a missing
// ingredient) adds with its + or a swipe, and swipes away as "Have it". The
// section's header link does every row. Long sections fold under Show all. Rows leave as they are done, because the brief is read live from the
// stores. The helper's asks (HelperAskChips) sit above the text box, not in the chat.
// Native twin: apps/mobile/src/features/assistant/helper-brief.tsx.
import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import {
  SHOWN_ITEMS_FOLD,
  briefItemIds,
  arriveDelayMs,
  moduleHelper,
  useHelperBrief,
  type AssistantShown,
  type BriefRow,
  type BriefSection,
  type HelperBriefState,
} from '@homeup/core';
import { toast } from 'sonner';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { useDataCache } from '@/lib/data-cache';
import { cn } from '@/lib/utils';
import { ChatChanges, SuggestLine } from './chat-changes';

const arrive = (i: number) => ({ '--arrive-delay': `${arriveDelayMs(i)}ms` }) as CSSProperties;

/** A row that is a fact (a night, an occasion): its line, opening its screen. */
function InfoLine({ row }: { row: Extract<BriefRow, { kind: 'item' }> }) {
  const router = useRouter();
  const body = (
    <>
      <ListItemContent>
        <ListItemTitle>
          <span className="text-foreground">{row.title}</span>
        </ListItemTitle>
        {row.meta && <ListItemMeta>{row.meta}</ListItemMeta>}
      </ListItemContent>
      {row.trailing && (
        <ListItemTrailing>
          <span className={cn('text-xs tabular-nums', row.warn ? 'font-medium text-warning' : 'text-muted-foreground')}>{row.trailing}</span>
        </ListItemTrailing>
      )}
    </>
  );
  return row.href ? (
    <ListItem asChild>
      <button type="button" className="cursor-pointer text-left" onClick={() => router.push(row.href!)}>
        {body}
      </button>
    </ListItem>
  ) : (
    <ListItem>{body}</ListItem>
  );
}

function SuggestSection({ section, state }: { section: BriefSection; state: HelperBriefState | null }) {
  const [all, setAll] = useState(false);
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
      {hidden > 0 && (
        <ListItem asChild>
          <button type="button" className="cursor-pointer justify-center text-sm font-medium text-foreground" onClick={() => setAll(true)}>
            Show all {section.rows.length}
          </button>
        </ListItem>
      )}
    </ListGroup>
  );
}

export function HelperBrief({ helper }: { helper: string }) {
  const { group, currentUserId } = useDataCache();
  const state = useHelperBrief({ helper, groupId: group?.id, currentUserId });
  const def = moduleHelper(helper);
  // Rows done this visit, so a section's link reads right while the store catches up.
  const [, setDone] = useState(0);
  if (!def) return null;
  const brief = state?.brief;
  const doAll = (section: BriefSection) => {
    const n = state?.all(section) ?? 0;
    if (n > 0) toast(section.id === 'dinners' ? `Added ${n} to the list` : `Put ${n} back on the list`);
    setDone((d) => d + n);
  };
  let i = 0;
  return (
    <div className="space-y-3">
      <div className="ask-arrive space-y-1.5 px-0.5 pt-1" style={arrive(i++)}>
        <h2 className="font-heading text-[26px] font-bold leading-tight text-foreground">{brief?.title ?? def.label}</h2>
        {brief && <p className="text-sm leading-snug text-muted-foreground">{brief.lede}</p>}
      </div>
      {brief?.sections.map((section) => (
        <div key={section.id} className="ask-arrive space-y-2" style={arrive(i++)}>
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
              <div className="flex items-center gap-2 px-1">
                <p className="flex-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{section.title}</p>
                {section.allLabel && (
                  <button type="button" onClick={() => doAll(section)} className="text-xs font-semibold text-primary hover:underline">
                    {section.allLabel}
                  </button>
                )}
              </div>
              <SuggestSection section={section} state={state} />
            </>
          )}
        </div>
      ))}
    </div>
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
    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAsk(def.summary.ask)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
      >
        <Sparkles className="size-3.5" />
        {def.summary.label}
      </button>
      {def.starters.map((text) => (
        <button
          key={text}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(text)}
          className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
