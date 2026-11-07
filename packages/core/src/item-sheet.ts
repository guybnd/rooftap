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
// Dates, times and "@name" in a title set Due, Time and Who while the words
// stay in the title, lit (Hearth §13.14). Adding takes them out. Words a
// person overrides by picking a value by hand stay plain text.

/** Words in a title that set a field, with where they sit in the title. */
export interface TitleMatch {
  kind: 'due' | 'time' | 'who';
  /** The words as typed, "next friday". */
  raw: string;
  /** YYYY-MM-DD for due, HH:MM for time, a person id for who. */
  value: string;
  /** Index of the first character in the title. */
  start: number;
  /** Index after the last character. */
  end: number;
}

export interface TitleWordsOptions {
  today: string;
  people?: readonly { id: string; name: string }[];
  /** Words (lowercase) that stay text. */
  ignore?: readonly string[];
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SHORT: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_SHORT: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH = `(${[...MONTH_NAMES, ...Object.keys(MONTH_SHORT)].join('|')})\\.?`;
const ORD = '(?:st|nd|rd|th)?';
const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const LEAD = '(?:(?:due|by|on|for)\\s+)?';

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '');
  const full = MONTH_NAMES.indexOf(w);
  return full >= 0 ? full : MONTH_SHORT[w];
}

function isoOf(y: number, m: number, d: number): string | null {
  const date = new Date(y, m, d);
  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) return null;
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

/** The same day `months` later, on the month's last day when it is shorter. */
function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const first = new Date(y, m + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoOf(first.getFullYear(), first.getMonth(), Math.min(d, last))!;
}

/** A day and month with no year: this year, or next year once it has passed. */
function nextDate(today: string, m: number, d: number, year?: string): string | null {
  if (year) return isoOf(Number(year), m, d);
  const [y] = parts(today);
  const iso = isoOf(y, m, d);
  if (iso && iso >= today) return iso;
  return isoOf(y + 1, m, d);
}

function nextWeekday(today: string, dow: number): string {
  const ahead = (dow - weekday(today) + 7) % 7;
  return addDaysISO(today, ahead === 0 ? 7 : ahead);
}

function count(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : COUNT_WORDS[word.toLowerCase()];
}

interface Rule {
  kind: TitleMatch['kind'];
  src: string;
  value: (m: RegExpExecArray, o: TitleWordsOptions) => string | null;
}

// Most specific first: "oct 8 2027" before "the 8th" before "8pm".
const RULES: Rule[] = [
  { kind: 'due', src: `(\\d{4})-(\\d{2})-(\\d{2})`, value: (m) => isoOf(Number(m[1]), Number(m[2]) - 1, Number(m[3])) },
  {
    kind: 'due',
    src: `${LEAD}${MONTH}\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?`,
    value: (m, o) => nextDate(o.today, monthIndex(m[1]), Number(m[2]), m[3]),
  },
  {
    kind: 'due',
    src: `${LEAD}(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4}))?`,
    value: (m, o) => nextDate(o.today, monthIndex(m[2]), Number(m[1]), m[3]),
  },
  {
    // A month alone needs "in" or a year: "in March", "March 2027". "may" stays a word.
    kind: 'due',
    src: `(?:in\\s+${MONTH}(?:\\s+(\\d{4}))?|${MONTH}\\s+(\\d{4}))`,
    value: (m, o) => {
      const month = monthIndex(m[1] ?? m[3]);
      const year = m[2] ?? m[4];
      return year ? isoOf(Number(year), month, 1) : nextDate(o.today, month, 1);
    },
  },
  {
    kind: 'due',
    src: `${LEAD}the\\s+(\\d{1,2})(?:st|nd|rd|th)`,
    value: (m, o) => {
      const day = Number(m[1]);
      const [y, mo] = parts(o.today);
      for (let i = 0; i < 12; i++) {
        const first = new Date(y, mo + i, 1);
        const iso = isoOf(first.getFullYear(), first.getMonth(), day);
        if (iso && iso >= o.today) return iso;
      }
      return null;
    },
  },
  {
    kind: 'due',
    src: `in\\s+(\\d{1,3}|${Object.keys(COUNT_WORDS).join('|')})\\s+(days?|weeks?|months?|years?)`,
    value: (m, o) => {
      const n = count(m[1]);
      const unit = m[2].toLowerCase().replace(/s$/, '');
      if (!n) return null;
      if (unit === 'day') return addDaysISO(o.today, n);
      if (unit === 'week') return addDaysISO(o.today, n * 7);
      return addMonthsISO(o.today, unit === 'month' ? n : n * 12);
    },
  },
  { kind: 'due', src: `${LEAD}(?:the\\s+)?day\\s+after\\s+tomorrow`, value: (_m, o) => addDaysISO(o.today, 2) },
  { kind: 'due', src: `${LEAD}(?:today|tonight)`, value: (_m, o) => o.today },
  { kind: 'due', src: `${LEAD}(?:tomorrow|tmrw|tmr)`, value: (_m, o) => addDaysISO(o.today, 1) },
  { kind: 'due', src: `${LEAD}next\\s+week`, value: (_m, o) => addDaysISO(o.today, 7) },
  { kind: 'due', src: `${LEAD}next\\s+month`, value: (_m, o) => addMonthsISO(o.today, 1) },
  { kind: 'due', src: `${LEAD}next\\s+year`, value: (_m, o) => addMonthsISO(o.today, 12) },
  {
    kind: 'due',
    src: `${LEAD}(this|next|on\\s+the|at\\s+the)\\s+weekend`,
    value: (m, o) => {
      const coming = weekday(o.today) === 6 ? o.today : nextWeekday(o.today, 6);
      return m[1].toLowerCase() === 'next' ? addDaysISO(coming, 7) : coming;
    },
  },
  {
    kind: 'due',
    src: `${LEAD}(?:(?:this|next)\\s+)?(${DAY_NAMES.join('|')})`,
    value: (m, o) => nextWeekday(o.today, DAY_NAMES.indexOf(m[1].toLowerCase())),
  },
  {
    // Short day names need "on", "this" or "next": "sat down" stays text.
    kind: 'due',
    src: `(?:due\\s+|by\\s+)?(?:on|this|next)\\s+(${Object.keys(DAY_SHORT).join('|')})`,
    value: (m, o) => nextWeekday(o.today, DAY_SHORT[m[1].toLowerCase()]),
  },
  {
    kind: 'time',
    src: `(?:at\\s+)?(\\d{1,2})(?::([0-5]\\d))?\\s?(am|pm)`,
    value: (m) => {
      const h = Number(m[1]);
      if (h < 1 || h > 12) return null;
      const h24 = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
      return `${String(h24).padStart(2, '0')}:${m[2] ?? '00'}`;
    },
  },
  { kind: 'time', src: `(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)`, value: (m) => `${m[1].padStart(2, '0')}:${m[2]}` },
  { kind: 'time', src: `(?:at\\s+)?noon`, value: () => '12:00' },
  {
    kind: 'who',
    src: `@([\\p{L}\\d._-]+)`,
    value: (m, o) => {
      const typed = m[1].toLowerCase();
      const hit = (o.people ?? []).find((p) => p.id && p.name.toLowerCase().startsWith(typed));
      return hit ? hit.id : null;
    },
  },
];

const END = '(?=[\\s,.;!?)]|$)';
const COMPILED = RULES.map((rule) => ({
  rule,
  scan: new RegExp(`(^|[\\s(,])(${rule.src})${END}`, 'giu'),
  whole: new RegExp(`^(?:${rule.src})$`, 'iu'),
}));

/**
 * The dates, times and people a title names, at most one of each, in title
 * order. "tonight" also gives Evening. Words in `ignore` stay text.
 */
export function matchTitleWords(title: string, options: TitleWordsOptions): TitleMatch[] {
  const ignore = new Set((options.ignore ?? []).map((w) => w.toLowerCase()));
  const found: TitleMatch[] = [];
  const free = (start: number, end: number) => found.every((f) => end <= f.start || start >= f.end);
  for (const { rule, scan, whole } of COMPILED) {
    if (found.some((f) => f.kind === rule.kind)) continue;
    scan.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = scan.exec(title))) {
      const raw = m[2];
      const start = m.index + m[1].length;
      const end = start + raw.length;
      if (!free(start, end) || ignore.has(raw.toLowerCase())) continue;
      const inner = whole.exec(raw);
      const value = inner ? rule.value(inner, options) : null;
      if (!value) continue;
      found.push({ kind: rule.kind, raw, value, start, end });
      if (rule.kind === 'due' && /tonight/i.test(raw) && !found.some((x) => x.kind === 'time')) {
        found.push({ kind: 'time', raw, value: '18:00', start, end });
      }
      break;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The title with the matched words taken out: "Cancel Uber One tomorrow" to "Cancel Uber One". */
export function stripTitleWords(title: string, matches: readonly TitleMatch[]): string {
  let text = title;
  const ranges = [...new Map(matches.map((m) => [`${m.start}:${m.end}`, m])).values()].sort((a, b) => b.start - a.start);
  for (const m of ranges) text = text.slice(0, m.start) + text.slice(m.end);
  return text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/^[\s,]+|[\s,]+$/g, '');
}

/** What a word's field shows: "Tomorrow", "5:00 PM", "Sam". */
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
