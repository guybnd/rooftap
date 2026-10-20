"use client";

// FLUX-233 #4: a real month-grid date picker, replacing the calendar page's
// prev/next-only date selector. Deliberately standalone (no coupling to
// calendar/page.tsx's abbreviated MONTHS/day-math) so it can be reused anywhere
// a date needs picking.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

interface MonthDatePickerProps {
  open: boolean;
  initialDate: Date;
  onClose: () => void;
  onSelect: (date: Date) => void;
  /** FLUX-257: renders a "Jump to today" shortcut next to the month title when provided. */
  onToday?: () => void;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function MonthDatePicker({ open, initialDate, onClose, onSelect, onToday }: MonthDatePickerProps) {
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  // Re-seed the visible month to the current selection on every closed→open
  // transition, so reopening never strands the user on a month they merely
  // browsed through last time without picking.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setViewYear(initialDate.getFullYear());
      setViewMonth(initialDate.getMonth());
    }
    wasOpen.current = open;
  }, [open, initialDate]);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const goPrevYear = () => setViewYear((y) => y - 1);
  const goNextYear = () => setViewYear((y) => y + 1);

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();

  // Always 42 cells (6 weeks) so the grid height never jumps between months.
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(viewYear, viewMonth, 1 - startWeekday + i));
  }

  const today = new Date();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader className="flex-row items-center justify-between gap-2 pr-6 space-y-0">
          <DialogTitle>Select date</DialogTitle>
          {onToday && (
            <button
              type="button"
              onClick={onToday}
              className="text-xs font-medium text-primary hover:underline"
            >
              Jump to today
            </button>
          )}
        </DialogHeader>

        <div className="flex items-center justify-between gap-1 pr-6">
          <div className="flex items-center">
            <button
              type="button"
              onClick={goPrevYear}
              aria-label="Previous year"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goPrevMonth}
              aria-label="Previous month"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
          <span className="text-sm font-semibold">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <div className="flex items-center">
            <button
              type="button"
              onClick={goNextMonth}
              aria-label="Next month"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goNextYear}
              aria-label="Next year"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 pt-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">
              {w}
            </div>
          ))}
          {cells.map((date, i) => {
            const inMonth = date.getMonth() === viewMonth;
            const isToday = isSameDay(date, today);
            const isSelected = isSameDay(date, initialDate);
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(date)}
                className={cn(
                  "aspect-square rounded-md text-xs font-medium transition-colors flex items-center justify-center",
                  inMonth ? "text-foreground hover:bg-muted" : "text-muted-foreground/40 hover:bg-muted/50",
                  isToday && "border border-primary/50 text-primary font-semibold",
                  isSelected && "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                )}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
