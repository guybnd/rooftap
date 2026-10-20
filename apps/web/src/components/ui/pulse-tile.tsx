'use client';

// Hearth 5 (FLUX-276): the shared inset "pulse" tile used by every section
// page's pulse strip (Costs/Setup/Groceries/Appointments). Inset fill, no
// border (H4) — the list/card beneath it owns the one bordered level. Meter
// is optional: tiles that show a signed delta or a bare count (not a
// fraction of a whole) render meter-less.

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ProgressBar } from './progress-bar';

export type PulseTileTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE_VALUE_CLASS: Record<PulseTileTone, string> = {
  neutral: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

const TONE_FILL_CLASS: Record<PulseTileTone, string> = {
  neutral: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

export interface PulseTileProps {
  /** Micro-label (T4: 10.5px uppercase +0.1em). */
  label: string;
  /** Tabular, value-first; unit/qualifier text should be wrapped in a muted span by the caller. */
  value: ReactNode;
  /** Omit for a meter-less tile (a delta or bare count, not a fraction of a whole). */
  meter?: { value: number; total: number };
  tone?: PulseTileTone;
  className?: string;
}

export function PulseTile({ label, value, meter, tone = 'neutral', className }: PulseTileProps) {
  return (
    <div className={cn('flex min-h-[44px] flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5', className)}>
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground truncate">
        {label}
      </span>
      <span className={cn('text-sm font-semibold tabular-nums', TONE_VALUE_CLASS[tone])}>{value}</span>
      {meter && (
        <ProgressBar
          value={meter.value}
          total={meter.total}
          fillClassName={TONE_FILL_CLASS[tone]}
          className="h-[3px]"
        />
      )}
    </div>
  );
}
