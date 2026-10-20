'use client';

import { formatMoney, type SetupItem } from '@homeup/core';
import { PulseTile } from '@/components/ui/pulse-tile';

interface BudgetSummaryProps {
  items: SetupItem[];
}

// Setup prices are whole dollars; formatMoney takes minor units.
const formatCurrency = (amount: number) => formatMoney(Math.round(amount * 100));

// One card (H4): three inset totals, then spend per room as hairline rows,
// value first with the estimate in muted type (H6). No figure here is a
// lede, so nothing is set at display size, and money stays neutral: coral is
// for controls and green for state (H2). "To buy" is the estimate of what is
// still needed, which is also what a per-status split used to repeat.
export function BudgetSummary({ items }: BudgetSummaryProps) {
  const totalEstimated = items.reduce((sum, item) => sum + (item.est_price || 0), 0);

  const totalSpent = items
    .filter((item) => item.status === 'installed')
    .reduce((sum, item) => sum + (item.actual_price || 0), 0);

  const remainingEstimated = items
    .filter((item) => item.status === 'needed')
    .reduce((sum, item) => sum + (item.est_price || 0), 0);

  const byRoom = items.reduce(
    (acc, item) => {
      const room = item.room || 'Other';
      if (!acc[room]) acc[room] = { estimated: 0, spent: 0 };
      acc[room].estimated += item.est_price || 0;
      if (item.status === 'installed') {
        acc[room].spent += item.actual_price || 0;
      }
      return acc;
    },
    {} as Record<string, { estimated: number; spent: number }>
  );
  const rooms = Object.entries(byRoom).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-3 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]">
      <div className="grid grid-cols-3 gap-2">
        <PulseTile label="Estimated" value={formatCurrency(totalEstimated)} />
        <PulseTile label="Spent" value={formatCurrency(totalSpent)} />
        <PulseTile label="To buy" value={formatCurrency(remainingEstimated)} />
      </div>

      {rooms.length > 0 && (
        <div>
          <div className="flex items-center justify-between px-1 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <span>By room</span>
            <span>Spent of est</span>
          </div>
          <ul className="divide-y divide-border/60">
            {rooms.map(([room, { estimated, spent }]) => (
              <li key={room} className="flex items-center justify-between gap-3 px-1 py-2 text-sm">
                <span className="min-w-0 truncate text-foreground">{room}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium text-foreground">{formatCurrency(spent)}</span>
                  <span className="text-xs text-muted-foreground"> of {formatCurrency(estimated)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
