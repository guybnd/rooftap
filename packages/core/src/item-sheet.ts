// The add and edit item sheet's shared logic (Hearth E1-E4, §7): the quick
// choices each property row offers, the words a row shows for its value, the
// title check, and the draft a closed add sheet keeps. Both apps' ItemSheet
// (packages/ui on the phone, apps/web/src/components/ui/item-sheet.tsx) and
// every module's sheet read these, so a row says the same thing everywhere.
import { addDaysISO, daysBetweenISO, dueDayLabel, formatTime12h } from './date-utils';

/** A quick date choice in the Due editor. `value` is YYYY-MM-DD, or '' for no date. */
export interface DueChoice {
  id: 'today' | 'tomorrow' | 'weekend' | 'next-week' | 'none';
  label: string;
  value: string;
}

function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * Today, Tomorrow, the coming Saturday ("This weekend", or "Next weekend"
 * when today is already Saturday or Sunday), a week from today and no date.
 */
export function dueQuickChoices(today: string): DueChoice[] {
  const dow = weekday(today);
  const toSaturday = (6 - dow + 7) % 7;
  const weekendOver = dow === 6 || dow === 0;
  const saturday = addDaysISO(today, weekendOver ? (dow === 6 ? 7 : 6) : toSaturday);
  return [
    { id: 'today', label: 'Today', value: today },
    { id: 'tomorrow', label: 'Tomorrow', value: addDaysISO(today, 1) },
    { id: 'weekend', label: weekendOver ? 'Next weekend' : 'This weekend', value: saturday },
    { id: 'next-week', label: 'Next week', value: addDaysISO(today, 7) },
    { id: 'none', label: 'No date', value: '' },
  ];
}

/** One day in the Due editor's week strip. */
export interface WeekStripDay {
  iso: string;
  /** One letter weekday, "M". */
  letter: string;
  /** Day of the month, 12. */
  day: number;
  isToday: boolean;
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The week the strip shows: seven days from today, moved by whole weeks.
 * `weekOffset` 0 starts today, 1 starts a week from today.
 */
export function weekStrip(today: string, weekOffset = 0): WeekStripDay[] {
  const start = addDaysISO(today, weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysISO(start, i);
    return { iso, letter: WEEKDAY_LETTERS[weekday(iso)], day: Number(iso.slice(8, 10)), isToday: iso === today };
  });
}

/** The strip week that holds `value` (0 when it is empty or in the past). */
export function weekStripOffsetFor(value: string, today: string): number {
  if (!value) return 0;
  const diff = daysBetweenISO(today, value);
  return diff < 0 ? 0 : Math.floor(diff / 7);
}

/** The month a week strip mostly sits in, "November", for the strip's caption. */
export function weekStripMonth(days: WeekStripDay[]): string {
  const mid = days[3] ?? days[0];
  const [y, m] = mid.iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' });
}

/** What the Due row shows: "Today", "Thu", "Nov 12", "3d overdue" or "No date". */
export function dueValueLabel(value: string | null | undefined, today: string): string {
  return value ? dueDayLabel(value, today) : 'No date';
}

/** A named time in the Time editor. */
export interface TimeChoice {
  id: 'any' | 'morning' | 'lunch' | 'evening';
  label: string;
  /** HH:MM, or '' for any time. */
  value: string;
}

export const TIME_QUICK_CHOICES: readonly TimeChoice[] = [
  { id: 'any', label: 'Any time', value: '' },
  { id: 'morning', label: 'Morning', value: '09:00' },
  { id: 'lunch', label: 'Lunch', value: '12:30' },
  { id: 'evening', label: 'Evening', value: '18:00' },
];

/** What the Time row shows: "6:00 PM", or "Any time" when there is none. */
export function timeValueLabel(value: string | null | undefined): string {
  return value ? formatTime12h(value.slice(0, 5)) : 'Any time';
}

/** A named time's chip label, with its clock time: "Evening 6:00". */
export function timeChoiceLabel(choice: TimeChoice): string {
  if (!choice.value) return choice.label;
  const [h, m] = choice.value.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${choice.label} ${h12}:${String(m).padStart(2, '0')}`;
}

/**
 * The title band's message. Shown only after someone tried to add with an
 * empty title, and gone as soon as there is text.
 */
export function itemTitleError(title: string, attempted: boolean): string | null {
  return attempted && !title.trim() ? 'Give it a name first' : null;
}

/** The toast after a dated add: "Added to Today", "Added to Tomorrow", "Added for Thu". */
export function addedToLabel(due: string | null | undefined, today: string): string {
  if (!due) return 'Added';
  const label = dueDayLabel(due, today);
  return label === 'Today' || label === 'Tomorrow' ? `Added to ${label}` : `Added for ${label}`;
}

/** The short name a Who row or face shows: "Guy" from "Guy Banda" or "guy@x.com". */
export function personFirstName(label: string): string {
  return label.trim().split(/[\s@]/)[0] || label;
}

/** First letter of a person's name for a face with no photo. */
export function personInitial(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

// ── Drafts ───────────────────────────────────────────────────────────────
// An add sheet that closes with typing in it keeps the draft for this app
// session, so a stray swipe never loses words and never needs a dialog.
// Opening the same kind of add sheet again (with nothing pre-filled) brings
// it back. In memory only: a restart starts clean.

const drafts = new Map<string, unknown>();

export const itemSheetDrafts = {
  get<T>(key: string): T | undefined {
    return drafts.get(key) as T | undefined;
  },
  set<T>(key: string, value: T): void {
    drafts.set(key, value);
  },
  clear(key: string): void {
    drafts.delete(key);
  },
};
