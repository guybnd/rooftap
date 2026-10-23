'use client';

// Money insights on Costs (the money-insights module, Oct 23): a "Worth a
// look" card with the three most pressing, and "See all" opening a sheet
// grouped into Heads up, Save, Reconsider and Going well. Tapping a row in the
// sheet opens its actions: open the cost or category, compare with Scout,
// review the subscriptions (Keep for a year, or a reminder to cancel), or hide
// it. The list comes from core useCostInsights, the same on both apps. Phone
// twin: apps/mobile/src/features/costs/cost-insights.tsx.

import { useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarRange,
  ChevronRight,
  Clock,
  Gauge,
  Layers,
  Repeat,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  COST_INSIGHT_GROUPS,
  formatMoney,
  scoutPrefillHref,
  useCostInsights,
  useModules,
  withInsightMark,
  withoutInsightMark,
  type CostCategory,
  type CostInsight,
  type CostInsightMarks,
  type CostItem,
  type SubscriptionLine,
} from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { LeadingTile } from '@/components/ui/leading-tile';
import { toastUndoAction } from '@/lib/undo-toast';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CARD = 'overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]';
const SHEET =
  'max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4';
const CHIP = 'inline-flex min-h-8 items-center rounded-full border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted';
/** Rows the card shows before "See all". */
const SHOWN = 3;

const ICON: Record<CostInsight['kind'], ComponentType<{ className?: string }>> = {
  short: Wallet,
  missing: Clock,
  differs: ArrowLeftRight,
  price: TrendingUp,
  'price-down': TrendingDown,
  new: Repeat,
  ahead: Gauge,
  subscriptions: Repeat,
  overlap: Layers,
  ending: CalendarClock,
  yearly: CalendarRange,
  under: Sparkles,
  goal: Sparkles,
};

const TONE = { warning: 'text-warning', success: 'text-success', muted: 'text-muted-foreground' } as const;

export interface CostInsightsCardProps {
  items: readonly CostItem[];
  goalCents: number | null;
  marks: CostInsightMarks;
  /** Changes this person's marks from the latest ones. */
  onMarks: (update: (cur: CostInsightMarks) => CostInsightMarks) => void;
  onOpenItem: (item: CostItem) => void;
  onOpenCategory: (category: CostCategory | null) => void;
  /** Adds a "Cancel it?" reminder task; null when Tasks is off. */
  onRemind: ((sub: SubscriptionLine) => void) | null;
}

export function CostInsightsCard(props: CostInsightsCardProps) {
  const { items, goalCents, marks, onMarks } = props;
  const { insights, subscriptions } = useCostInsights(items, { goalCents, marks });
  const [sheet, setSheet] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!insights.length) return null;

  const openSheet = (key: string | null) => {
    setExpanded(key);
    setSheet(true);
  };
  const hide = (i: CostInsight) => {
    onMarks((cur) => withInsightMark(cur, i.key));
    setExpanded(null);
    toastUndoAction('Hidden', () => onMarks((cur) => withoutInsightMark(cur, i.key)));
  };

  return (
    <section className="space-y-2" aria-label="Worth a look">
      <h2 className={cn(LABEL, 'px-1')}>Worth a look</h2>
      <div className={CARD}>
        {insights.slice(0, SHOWN).map((i, n) => (
          <InsightRow key={i.key} insight={i} divided={n > 0} onClick={() => openSheet(i.key)} />
        ))}
        {insights.length > SHOWN && (
          <button
            type="button"
            onClick={() => openSheet(null)}
            className="flex min-h-11 w-full items-center justify-between border-t border-border/60 px-4 text-sm font-medium text-primary hover:bg-muted/40"
          >
            <span>See all {insights.length}</span>
            <ChevronRight className="size-4" />
          </button>
        )}
      </div>

      <BottomSheet
        open={sheet}
        onOpenChange={setSheet}
        overlayClassName="bg-black/40"
        className={SHEET}
        handleClassName="sm:hidden"
        popupProps={{ 'aria-label': 'Worth a look' }}
      >
        <h3 className="px-1 pb-1 pt-1 font-heading text-lg font-semibold">Worth a look</h3>
        <p className="px-1 pb-2 text-xs text-muted-foreground">Tap one for what you can do. Hiding one keeps it away until it changes.</p>
        {COST_INSIGHT_GROUPS.map((g) => {
          const rows = insights.filter((i) => i.group === g.id);
          if (!rows.length) return null;
          return (
            <div key={g.id} className="pb-2">
              <h4 className={cn(LABEL, 'px-1 pb-1 pt-3')}>{g.label}</h4>
              <div className="overflow-hidden rounded-2xl bg-muted/40">
                {rows.map((i, n) => (
                  <div key={i.key} className={cn(n > 0 && 'border-t border-border/60')}>
                    <InsightRow insight={i} divided={false} expanded={expanded === i.key} onClick={() => setExpanded((cur) => (cur === i.key ? null : i.key))} />
                    {expanded === i.key && (
                      <InsightActions
                        insight={i}
                        subscriptions={subscriptions}
                        onHide={() => hide(i)}
                        onDone={() => setSheet(false)}
                        {...props}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </BottomSheet>
    </section>
  );
}

function InsightRow({ insight: i, divided, expanded, onClick }: { insight: CostInsight; divided: boolean; expanded?: boolean; onClick: () => void }) {
  const Icon = ICON[i.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cn('flex min-h-[55px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40', divided && 'border-t border-border/60')}
    >
      <LeadingTile sectionId="costs" Icon={Icon} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{i.title}</span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums">{i.detail}</span>
      </span>
      {i.figure && <span className={cn('shrink-0 text-xs font-semibold tabular-nums', TONE[i.figure.tone])}>{i.figure.text}</span>}
    </button>
  );
}

function InsightActions({
  insight: i,
  subscriptions,
  onMarks,
  onHide,
  onDone,
  onOpenItem,
  onOpenCategory,
  onRemind,
}: CostInsightsCardProps & { insight: CostInsight; subscriptions: SubscriptionLine[]; onHide: () => void; onDone: () => void }) {
  const router = useRouter();
  const modules = useModules();
  const compare = modules.feature('insights.compare') && i.compare;

  return (
    <div className="space-y-2 px-4 pb-3 pl-[64px]">
      {i.action === 'review' && (
        <ul className="divide-y divide-border/60 rounded-xl bg-card">
          {subscriptions.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{s.name}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {formatMoney(s.monthlyCents)} a month
                  {s.overlap ? ` · ${s.overlap.toLowerCase()} overlap` : ''}
                </span>
              </span>
              <button
                type="button"
                className={cn(CHIP, s.kept && 'border-transparent bg-muted text-muted-foreground')}
                onClick={() => onMarks((cur) => (s.kept ? withoutInsightMark(cur, `keep:${s.key}`) : withInsightMark(cur, `keep:${s.key}`)))}
                aria-pressed={s.kept}
              >
                {s.kept ? 'Kept' : 'Keep'}
              </button>
              {onRemind && s.item && !s.kept && (
                <button type="button" className={CHIP} onClick={() => onRemind(s)}>
                  Remind me to cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {i.action === 'open-item' && i.item && (
          <button type="button" className={CHIP} onClick={() => { onDone(); onOpenItem(i.item!); }}>
            Open {i.item.name}
          </button>
        )}
        {i.action === 'open-category' && (
          <button type="button" className={CHIP} onClick={() => { onDone(); onOpenCategory(i.category ?? null); }}>
            Show the category
          </button>
        )}
        {i.action === 'compare' && compare && (
          <button type="button" className={CHIP} onClick={() => { onDone(); router.push(scoutPrefillHref(i.compare!)); }}>
            Compare with Scout
          </button>
        )}
        {i.action === 'compare' && i.item && (
          <button type="button" className={CHIP} onClick={() => { onDone(); onOpenItem(i.item!); }}>
            Open {i.item.name}
          </button>
        )}
        <button type="button" className={cn(CHIP, 'text-muted-foreground')} onClick={onHide}>
          Hide
        </button>
      </div>
    </div>
  );
}
