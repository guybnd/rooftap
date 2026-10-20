// HOUP-80: native port of apps/web/src/app/groceries/snooze-menu.tsx —
// BottomSheet in place of the web PopMenu. The 1d/1w/1m presets plus a
// "Pick a date" row that swaps the sheet for a month-grid picker (the native
// stand-in for the web version's `<input type="date">`).
import * as React from 'react';
import { BottomSheet, ListGroup, ListItem, ListItemTitle, MonthDatePicker } from '@homeup/ui';
import { addDaysISO, snoozeUntilISO, toISODate, todayISO } from '@homeup/core';

interface SnoozeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (untilISO: string) => void;
}

const PRESETS: { key: '1d' | '1w' | '1m'; label: string }[] = [
  { key: '1d', label: 'Tomorrow' },
  { key: '1w', label: 'Next week' },
  { key: '1m', label: 'Next month' },
];

export function SnoozeSheet({ open, onOpenChange, onSnooze }: SnoozeSheetProps) {
  const [pickingDate, setPickingDate] = React.useState(false);
  const [y, m, d] = addDaysISO(todayISO(), 1).split('-').map(Number);

  return (
    <>
      {/* The sheet stays logically open while the picker shows, so the caller
          keeps its snooze target until a date is chosen or the picker closes. */}
      <BottomSheet open={open && !pickingDate} onOpenChange={onOpenChange} className="pb-2">
        <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
          {PRESETS.map((p) => (
            <ListItem key={p.key} onPress={() => onSnooze(snoozeUntilISO(p.key))}>
              <ListItemTitle>{p.label}</ListItemTitle>
            </ListItem>
          ))}
          <ListItem
            onPress={() => setPickingDate(true)}
          >
            <ListItemTitle>Pick a date</ListItemTitle>
          </ListItem>
        </ListGroup>
      </BottomSheet>
      <MonthDatePicker
        open={open && pickingDate}
        initialDate={new Date(y, m - 1, d)}
        onClose={() => {
          setPickingDate(false);
          onOpenChange(false);
        }}
        onSelect={(date) => {
          setPickingDate(false);
          onSnooze(toISODate(date));
        }}
      />
    </>
  );
}
