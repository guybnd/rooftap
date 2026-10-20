// HOUP-81: universal port of apps/web/src/components/month-date-picker.tsx —
// a real month-grid date picker. Pure taps, so the port only swaps the
// centered `Dialog` wrapper for `BottomSheet` (RN has no centered-modal
// primitive in @homeup/ui); the grid/nav logic is unchanged.
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react-native';
import { cn } from '../lib/cn';
import { select } from '../lib/haptics';
import { BottomSheet } from './bottom-sheet';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export interface MonthDatePickerProps {
  open: boolean;
  initialDate: Date;
  onClose: () => void;
  onSelect: (date: Date) => void;
  /** Renders a "Jump to today" shortcut next to the month title when provided. */
  onToday?: () => void;
  /** Marks days that have something on them with a small dot. */
  hasItems?: (date: Date) => boolean;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function MonthDatePicker({ open, initialDate, onClose, onSelect, onToday, hasItems }: MonthDatePickerProps) {
  const [viewYear, setViewYear] = React.useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(initialDate.getMonth());

  // Re-seed the visible month to the current selection on every closed→open
  // transition, so reopening never strands the user on a month they merely
  // browsed through last time without picking.
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
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
    <BottomSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <View className="gap-3 px-4 pb-2 pt-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-heading text-title font-medium text-foreground">Select date</Text>
          {onToday && (
            <Pressable
              onPress={() => {
                select();
                onToday?.();
              }}
              accessibilityRole="button"
            >
              <Text className="text-xs font-medium text-primary">Jump to today</Text>
            </Pressable>
          )}
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Pressable onPress={goPrevYear} accessibilityRole="button" accessibilityLabel="Previous year" className="rounded p-1 active:bg-muted">
              <ChevronsLeft size={16} className="text-muted-foreground" />
            </Pressable>
            <Pressable onPress={goPrevMonth} accessibilityRole="button" accessibilityLabel="Previous month" className="rounded p-1 active:bg-muted">
              <ChevronLeft size={16} className="text-muted-foreground" />
            </Pressable>
          </View>
          <Text className="text-sm font-semibold text-foreground">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </Text>
          <View className="flex-row items-center">
            <Pressable onPress={goNextMonth} accessibilityRole="button" accessibilityLabel="Next month" className="rounded p-1 active:bg-muted">
              <ChevronRight size={16} className="text-muted-foreground" />
            </Pressable>
            <Pressable onPress={goNextYear} accessibilityRole="button" accessibilityLabel="Next year" className="rounded p-1 active:bg-muted">
              <ChevronsRight size={16} className="text-muted-foreground" />
            </Pressable>
          </View>
        </View>

        <View className="flex-row flex-wrap">
          {WEEKDAY_LABELS.map((w, i) => (
            <View key={i} style={{ width: '14.28%' }} className="items-center py-1">
              <Text className="text-[10px] font-medium text-muted-foreground">{w}</Text>
            </View>
          ))}
          {cells.map((date, i) => {
            const inMonth = date.getMonth() === viewMonth;
            const isToday = isSameDay(date, today);
            const isSelected = isSameDay(date, initialDate);
            const marked = hasItems?.(date) ?? false;
            return (
              <View key={i} style={{ width: '14.28%' }} className="aspect-square p-0.5">
                <Pressable
                  onPress={() => {
                    select();
                    onSelect(date);
                  }}
                  accessibilityRole="button"
                  className={cn(
                    'flex-1 items-center justify-center rounded-md',
                    isSelected && 'bg-primary',
                    isToday && !isSelected && 'border border-primary/50'
                  )}
                >
                  <Text
                    className={cn(
                      'text-xs font-medium',
                      inMonth ? 'text-foreground' : 'text-muted-foreground/40',
                      isToday && !isSelected && 'font-semibold text-primary',
                      isSelected && 'font-semibold text-primary-foreground'
                    )}
                  >
                    {date.getDate()}
                  </Text>
                  {/* Same neutral count marker as the calendar's week strip. */}
                  <View
                    className={cn(
                      'mt-0.5 h-1 w-1 rounded-full',
                      marked ? (isSelected ? 'bg-primary-foreground' : inMonth ? 'bg-muted-foreground/70' : 'bg-muted-foreground/30') : 'bg-transparent'
                    )}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </BottomSheet>
  );
}
