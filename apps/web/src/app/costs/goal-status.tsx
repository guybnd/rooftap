'use client';

// The goal status under a spend bar, a dot per line (core goalStatus): the
// Costs hero and Home's Budget space. Phone twin:
// apps/mobile/src/features/costs/goal-status.tsx.

import type { GoalStatusLine } from '@homeup/core';
import { cn } from '@/lib/utils';

const DOT: Record<GoalStatusLine['tone'], string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', neutral: 'bg-muted-foreground' };

/** `hover` replaces the first line (the Costs spend bar's hovered segment). */
export function GoalStatusLines({ lines, hover }: { lines: readonly GoalStatusLine[]; hover?: string | null }) {
  return (
    <div className="space-y-1 pt-0.5 text-sm tabular-nums">
      {lines.map((l, i) => (
        <p key={i} className="flex items-center gap-2">
          <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', DOT[l.tone])} />
          {i === 0 && hover ? (
            <span className="font-semibold text-foreground">{hover}</span>
          ) : (
            <span>
              <span className="font-semibold text-foreground">{l.lead}</span>
              {l.detail ? <span className="text-muted-foreground"> {l.detail}</span> : null}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}
