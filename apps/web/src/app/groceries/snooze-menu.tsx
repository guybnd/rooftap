'use client';

// FLUX-207: shared "Snooze" menu for a suggest-re-add row — used identically
// by the /groceries list section and the Home hub card (artifact annotation:
// snoozing should be available from both surfaces).

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { PopMenu, MenuItem, MenuLabel } from '../setup/pop-menu';
import { snoozeUntilISO } from '@homeup/core';

export function SnoozeMenu({ onSnooze }: { onSnooze: (untilISO: string) => void }) {
  const [customDate, setCustomDate] = useState('');

  return (
    <PopMenu
      trigger={
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> Snooze
        </span>
      }
      triggerClassName="rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/70 transition-colors"
      align="right"
      width="w-60"
    >
      {(close) => (
        <>
          <MenuLabel>Still have it? Snooze</MenuLabel>
          <MenuItem onClick={() => { onSnooze(snoozeUntilISO('1d')); close(); }}>1 day</MenuItem>
          <MenuItem onClick={() => { onSnooze(snoozeUntilISO('1w')); close(); }}>1 week</MenuItem>
          <MenuItem onClick={() => { onSnooze(snoozeUntilISO('1m')); close(); }}>1 month</MenuItem>
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none focus:border-ring"
            />
            <button
              type="button"
              disabled={!customDate}
              onClick={() => { onSnooze(snoozeUntilISO(customDate)); close(); }}
              className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/70 transition-colors"
            >
              Set
            </button>
          </div>
        </>
      )}
    </PopMenu>
  );
}
