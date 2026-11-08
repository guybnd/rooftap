'use client';

// A module helper's brief (core module-helpers.ts): what needs a decision
// today, as rows that act at once, with no AI. A suggested row (a missing
// ingredient) adds with its +; an item row with an action (running low)
// goes back on the list with its +; the section's header link does every
// row. Rows leave as they are done, because the brief is read live from the
// stores. Under it, the helper's catch-up ask leads its starters, which send as asks.
// Native twin: apps/mobile/src/features/assistant/helper-brief.tsx.
import { useState, type CSSProperties } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { arriveDelayMs, moduleHelper, useHelperBrief, type BriefRow, type BriefSection } from '@homeup/core';
import { toast } from 'sonner';
import { ListGroup, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { useDataCache } from '@/lib/data-cache';
import { cn } from '@/lib/utils';

const arrive = (i: number) => ({ '--arrive-delay': `${arriveDelayMs(i)}ms` }) as CSSProperties;

function BriefLine({ row, onAdd, onAct }: { row: BriefRow; onAdd: (key: string) => void; onAct: (id: string) => void }) {
  const actionable = row.kind === 'suggest' || !!row.action;
  const label = row.kind === 'suggest' ? `Add ${row.title}` : `Put ${row.title} back on the list`;
  return (
    <ListItem className={cn(actionable && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--muted)_55%,transparent)_6px_7px)]')}>
      {actionable ? (
        <button
          type="button"
          onClick={() => (row.kind === 'suggest' ? onAdd(row.key) : onAct(row.id))}
          aria-label={label}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-primary/60 text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus className="size-4" />
        </button>
      ) : (
        <span aria-hidden className="size-9 shrink-0" />
      )}
      <ListItemContent>
        <ListItemTitle>
          <span className="text-foreground">{row.title}</span>
        </ListItemTitle>
        {row.meta && <ListItemMeta>{row.meta}</ListItemMeta>}
      </ListItemContent>
      {row.kind === 'item' && row.trailing && (
        <ListItemTrailing>
          <span className={cn('text-xs tabular-nums', row.warn ? 'font-medium text-warning' : 'text-muted-foreground')}>{row.trailing}</span>
        </ListItemTrailing>
      )}
    </ListItem>
  );
}

export function HelperBrief({ helper, onAsk, disabled }: { helper: string; onAsk: (text: string) => void; disabled: boolean }) {
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
          <div className="flex items-center gap-2 px-1">
            <p className="flex-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{section.title}</p>
            {section.allLabel && (
              <button type="button" onClick={() => doAll(section)} className="text-xs font-semibold text-primary hover:underline">
                {section.allLabel}
              </button>
            )}
          </div>
          <ListGroup>
            {section.rows.map((row) => (
              <BriefLine key={row.kind === 'suggest' ? `s:${row.key}` : row.id} row={row} onAdd={(k) => state?.add(k)} onAct={(id) => state?.act(id)} />
            ))}
          </ListGroup>
        </div>
      ))}
      <div className="ask-arrive flex flex-wrap gap-1.5 pt-1" style={arrive(i++)}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAsk(def.summary.ask)}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
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
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
