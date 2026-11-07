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

// ── Title words ──────────────────────────────────────────────────────────
// Typing "tomorrow", "friday", "5pm" or "@sam" into a title sets Due, Time
// or Who and takes the words out of the title. A word counts once something
// follows it (a space or a comma), or when the sheet saves (`final`), so
// "Mon" never fires on the way to "Monitor".

/** One set of words the title gave a field. */
export interface TitleMatch {
  kind: 'due' | 'time' | 'who';
  /** The words as typed, "next friday". */
  raw: string;
  /** YYYY-MM-DD for due, HH:MM for time, a person id for who. */
  value: string;
}

export interface TitleWordsOptions {
  today: string;
  people?: readonly { id: string; name: string }[];
  /** The sheet is saving: a word at the very end counts too. */
  final?: boolean;
  /** Words (lowercase) someone took back; they stay text. */
  ignore?: readonly string[];
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SHORT: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const LEAD = '(?:(?:due|by)\\s+)?';
const END = '(?=[\\s,.;!?]|$)';

function nextWeekday(today: string, dow: number): string {
  const ahead = (dow - weekday(today) + 7) % 7;
  return addDaysISO(today, ahead === 0 ? 7 : ahead);
}

interface Rule {
  kind: TitleMatch['kind'];
  re: RegExp;
  value: (m: RegExpExecArray, o: TitleWordsOptions) => string | null;
}

const RULES: Rule[] = [
  { kind: 'due', re: new RegExp(`${LEAD}(?:today|tonight)${END}`, 'i'), value: (_m, o) => o.today },
  { kind: 'due', re: new RegExp(`${LEAD}(?:tomorrow|tmrw|tmr)${END}`, 'i'), value: (_m, o) => addDaysISO(o.today, 1) },
  { kind: 'due', re: new RegExp(`${LEAD}next\\s+week${END}`, 'i'), value: (_m, o) => addDaysISO(o.today, 7) },
  {
    kind: 'due',
    re: new RegExp(`${LEAD}(this|next|on\\s+the|at\\s+the)\\s+weekend${END}`, 'i'),
    value: (m, o) => {
      const coming = weekday(o.today) === 6 ? o.today : nextWeekday(o.today, 6);
      return m[1].toLowerCase() === 'next' ? addDaysISO(coming, 7) : coming;
    },
  },
  {
    kind: 'due',
    re: new RegExp(`${LEAD}(?:(?:on|this|next)\\s+)?(${DAY_NAMES.join('|')})${END}`, 'i'),
    value: (m, o) => nextWeekday(o.today, DAY_NAMES.indexOf(m[1].toLowerCase())),
  },
  {
    // Short day names need "on", "this" or "next": "sat down" stays text.
    kind: 'due',
    re: new RegExp(`${LEAD}(?:on|this|next)\\s+(${Object.keys(DAY_SHORT).join('|')})${END}`, 'i'),
    value: (m, o) => nextWeekday(o.today, DAY_SHORT[m[1].toLowerCase()]),
  },
  {
    kind: 'time',
    re: new RegExp(`(?:at\\s+)?(\\d{1,2})(?::([0-5]\\d))?\\s?(am|pm)${END}`, 'i'),
    value: (m) => {
      const h = Number(m[1]);
      if (h < 1 || h > 12) return null;
      const h24 = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
      return `${String(h24).padStart(2, '0')}:${m[2] ?? '00'}`;
    },
  },
  {
    kind: 'time',
    re: new RegExp(`at\\s+([01]?\\d|2[0-3]):([0-5]\\d)${END}`, 'i'),
    value: (m) => `${m[1].padStart(2, '0')}:${m[2]}`,
  },
  {
    kind: 'who',
    re: new RegExp(`@([\\p{L}\\d._-]+)${END}`, 'iu'),
    value: (m, o) => {
      const typed = m[1].toLowerCase();
      const hit = (o.people ?? []).find((p) => p.id && p.name.toLowerCase().startsWith(typed));
      return hit ? hit.id : null;
    },
  },
];

/**
 * Finds date, time and person words in a title. Returns the title without
 * them and what each set of words means, or no matches when there is none.
 * "tonight" also gives Evening. One match per field.
 */
export function matchTitleWords(title: string, options: TitleWordsOptions): { title: string; matches: TitleMatch[] } {
  const ignore = new Set((options.ignore ?? []).map((w) => w.toLowerCase()));
  const matches: TitleMatch[] = [];
  let text = title;
  for (const rule of RULES) {
    if (matches.some((m) => m.kind === rule.kind)) continue;
    const re = new RegExp(`(^|\\s)(${rule.re.source})`, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = m[2];
      const start = m.index + m[1].length;
      const end = start + raw.length;
      if (end === text.length && !options.final) break;
      if (ignore.has(raw.toLowerCase())) continue;
      const inner = rule.re.exec(raw);
      const value = inner ? rule.value(inner, options) : null;
      if (!value) continue;
      matches.push({ kind: rule.kind, raw, value });
      if (rule.kind === 'due' && /tonight/i.test(raw) && !matches.some((x) => x.kind === 'time')) {
        matches.push({ kind: 'time', raw, value: '18:00' });
      }
      text = text.slice(0, m.index) + text.slice(end);
      break;
    }
  }
  if (!matches.length) return { title, matches };
  let cleaned = text.replace(/\s{2,}/g, ' ').replace(/^\s+/, '').replace(/\s+([,.;!?])/g, '$1');
  cleaned = options.final ? cleaned.trim() : cleaned;
  return { title: cleaned, matches };
}

/** What a recognised word chip says: "Tomorrow", "5:00 PM", "Sam". */
export function titleMatchLabel(match: TitleMatch, today: string, people: readonly { id: string; name: string }[] = []): string {
  if (match.kind === 'due') return dueValueLabel(match.value, today);
  if (match.kind === 'time') return timeValueLabel(match.value);
  return people.find((p) => p.id === match.value)?.name ?? match.raw.replace(/^@/, '');
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
