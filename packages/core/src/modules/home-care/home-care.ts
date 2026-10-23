// Home care: the upkeep a house needs, on a schedule the household chooses
// (a Care view in Home Setup). Nothing is scheduled until the household picks
// jobs, every job's interval, room, reminder and state can be changed, and the
// suggestions start at the long end of their usual interval (Guy, 2026-10-23:
// "thoroughly customize what we want to see and what not and how often with
// conservative default").
//
// A job's reminder is a household task keyed `care-reminder:<jobId>:<due>`
// (reminders.ts), so it shows on Home and in Calendar and notifies like a
// bill reminder. Finishing that task (Home, Tasks, the Assistant) advances the
// job in the database (migration 20261023090000_home_care); finishing the job
// on the Care view advances it here. Both follow nextDueAfter.
//
// Pure helpers only; both apps render from these.

import { addDaysISO, daysBetweenISO } from '../../date-utils';

export type CareUnit = 'day' | 'week' | 'month' | 'year';

/** active: scheduled. paused: kept, not scheduled. hidden: "we don't have this". */
export type CareJobState = 'active' | 'paused' | 'hidden';

export type CareArea = 'safety' | 'climate' | 'kitchen' | 'laundry' | 'plumbing' | 'outside' | 'pool' | 'garden' | 'other';

export interface CareLogEntry {
  /** Day it was done, YYYY-MM-DD. */
  on: string;
  by: string | null;
  /** The due date it was done against, so an undo can put it back. */
  prev_due: string | null;
  /** The reminder task that was finished, when it was finished from a task. */
  task_id?: string | null;
}

export interface CareJob {
  id: string;
  group_id: string;
  title: string;
  area: CareArea;
  room: string | null;
  /** The suggestion it came from (CARE_SUGGESTIONS id), or null for a job of your own. */
  suggestion_id: string | null;
  state: CareJobState;
  /** Every `every_n` `every_unit`s. Ignored while season_month is set. */
  every_n: number;
  every_unit: CareUnit;
  /** Once a year in this month (1-12), e.g. the month before summer. */
  season_month: number | null;
  next_due: string | null;
  last_done: string | null;
  assigned_to: string | null;
  remind: boolean;
  /** How many days before next_due the reminder is due. */
  remind_days_before: number;
  notes: string | null;
  done_log: CareLogEntry[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ── Seasons ─────────────────────────────────────────────────────────────────

export type Season = 'summer' | 'autumn' | 'winter' | 'spring';
export const SEASONS: readonly Season[] = ['summer', 'autumn', 'winter', 'spring'];

const SOUTHERN = new Set(['AU', 'NZ', 'ZA', 'AR', 'CL', 'UY']);

export function isSouthernHemisphere(region: string | null | undefined): boolean {
  return SOUTHERN.has((region ?? '').toUpperCase());
}

/** First month of each season (meteorological). */
function seasonStartMonth(season: Season, southern: boolean): number {
  const north: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };
  const m = north[season];
  return southern ? ((m + 5) % 12) + 1 : m;
}

/** The month a "before <season>" job is due: the month before the season starts. */
export function monthBeforeSeason(season: Season, southern: boolean): number {
  const start = seasonStartMonth(season, southern);
  return start === 1 ? 12 : start - 1;
}

/** The season a month falls in. */
export function seasonOfMonth(month: number, southern: boolean): Season {
  for (const s of SEASONS) {
    const start = seasonStartMonth(s, southern);
    const months = [start, (start % 12) + 1, ((start + 1) % 12) + 1];
    if (months.includes(month)) return s;
  }
  return 'summer';
}

/** The season whose "before" month this is, or null when it isn't one. */
export function seasonBeforeMonth(month: number, southern: boolean): Season | null {
  return SEASONS.find((s) => monthBeforeSeason(s, southern) === month) ?? null;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthShort(month: number): string {
  return MONTH_SHORT[(month - 1 + 12) % 12];
}

export function seasonLabel(season: Season): string {
  return season[0].toUpperCase() + season.slice(1);
}

/** "Sep to Nov" for a season. */
export function seasonMonthsLabel(season: Season, southern: boolean): string {
  const start = seasonStartMonth(season, southern);
  return `${monthShort(start)} to ${monthShort(((start + 1) % 12) + 1)}`;
}

// ── Dates ───────────────────────────────────────────────────────────────────

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Add whole months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28). */
export function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = parts(dateISO);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(ty, tm, 0).getDate();
  return iso(ty, tm, Math.min(d, last));
}

/** One interval on from a date. */
export function addIntervalISO(dateISO: string, n: number, unit: CareUnit): string {
  const k = Math.max(1, Math.round(n));
  if (unit === 'day') return addDaysISO(dateISO, k);
  if (unit === 'week') return addDaysISO(dateISO, k * 7);
  if (unit === 'month') return addMonthsISO(dateISO, k);
  return addMonthsISO(dateISO, k * 12);
}

/** The first day of `month` that falls after `afterISO`. */
export function nextMonthStartAfter(month: number, afterISO: string): string {
  const [y] = parts(afterISO);
  let candidate = iso(y, month, 1);
  while (candidate <= afterISO) candidate = addMonthsISO(candidate, 12);
  return candidate;
}

/**
 * When a job is next due after it was done on `doneISO`: one interval on from
 * that day, or the next start of its season month. The database trigger in
 * 20261023090000_home_care.sql applies the same rule.
 */
export function nextDueAfter(job: Pick<CareJob, 'every_n' | 'every_unit' | 'season_month'>, doneISO: string): string {
  if (job.season_month) return nextMonthStartAfter(job.season_month, doneISO);
  return addIntervalISO(doneISO, job.every_n, job.every_unit);
}

/**
 * When a newly chosen job is first due. Never done before, so nothing is
 * overdue on day one: a season job waits for its month, a short interval runs
 * from today, and anything longer starts a month out.
 */
export function firstDueDate(job: Pick<CareJob, 'every_n' | 'every_unit' | 'season_month'>, todayISO: string): string {
  if (job.season_month) return nextMonthStartAfter(job.season_month, addDaysISO(todayISO, -1));
  const one = addIntervalISO(todayISO, job.every_n, job.every_unit);
  const month = addMonthsISO(todayISO, 1);
  return one < month ? one : month;
}

/** The reminder task's due date: remind_days_before ahead of the job, never before today. */
export function careReminderDue(job: Pick<CareJob, 'next_due' | 'remind_days_before'>, todayISO: string): string | null {
  if (!job.next_due) return null;
  const due = addDaysISO(job.next_due, -Math.max(0, job.remind_days_before));
  return due < todayISO ? todayISO : due;
}

/** Whether the job should have an open reminder task. */
export function wantsReminder(job: Pick<CareJob, 'state' | 'remind' | 'next_due' | 'deleted'>): boolean {
  return !job.deleted && job.state === 'active' && job.remind && !!job.next_due;
}

// ── Labels ──────────────────────────────────────────────────────────────────

const UNIT_WORD: Record<CareUnit, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
};

/** "every 3 months", "monthly", "before summer". */
export function careEveryLabel(
  job: Pick<CareJob, 'every_n' | 'every_unit' | 'season_month'>,
  southern: boolean,
): string {
  if (job.season_month) {
    const season = seasonBeforeMonth(job.season_month, southern);
    return season ? `before ${season}` : `every ${monthShort(job.season_month)}`;
  }
  const n = Math.max(1, Math.round(job.every_n));
  if (n === 1) return { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[job.every_unit];
  return `every ${n} ${UNIT_WORD[job.every_unit][1]}`;
}

/** "12 Nov" this year, "Mar 2027" another year. */
export function careDateLabel(dateISO: string, todayISO: string): string {
  const [y, m, d] = parts(dateISO);
  return y === parts(todayISO)[0] ? `${d} ${monthShort(m)}` : `${monthShort(m)} ${y}`;
}

export type CareDueTone = 'overdue' | 'soon' | 'later';

export interface CareDue {
  tone: CareDueTone;
  /** "1 week overdue", "Friday", "12 Nov", "Dec". */
  text: string;
}

/** Days ahead that count as "due soon". */
export const CARE_SOON_DAYS = 14;

export function careDue(job: Pick<CareJob, 'next_due' | 'season_month'>, todayISO: string): CareDue | null {
  if (!job.next_due) return null;
  const diff = daysBetweenISO(todayISO, job.next_due);
  if (diff < 0) {
    const days = -diff;
    if (days < 7) return { tone: 'overdue', text: `${days} ${days === 1 ? 'day' : 'days'} overdue` };
    if (days < 60) {
      const w = Math.floor(days / 7);
      return { tone: 'overdue', text: `${w} ${w === 1 ? 'week' : 'weeks'} overdue` };
    }
    const mo = Math.floor(days / 30);
    return { tone: 'overdue', text: `${mo} months overdue` };
  }
  const [y, m, d] = parts(job.next_due);
  const date = new Date(y, m - 1, d);
  const tone: CareDueTone = diff <= CARE_SOON_DAYS ? 'soon' : 'later';
  if (diff === 0) return { tone, text: 'Today' };
  if (diff === 1) return { tone, text: 'Tomorrow' };
  if (diff < 7) return { tone, text: date.toLocaleDateString('en-AU', { weekday: 'long' }) };
  const [ty] = parts(todayISO);
  // A season job is due across its month, so it reads as the month.
  if (job.season_month && d === 1) {
    return { tone, text: y === ty ? monthShort(m) : `${monthShort(m)} ${y}` };
  }
  return {
    tone,
    text: y === ty ? `${d} ${monthShort(m)}` : `${monthShort(m)} ${y}`,
  };
}

// ── Lists ───────────────────────────────────────────────────────────────────

export function liveCareJobs(jobs: readonly (CareJob | null | undefined)[]): CareJob[] {
  return jobs.filter((j): j is CareJob => !!j && !j.deleted);
}

/** Active jobs in due order (undated last, then by title). */
export function sortByDue(jobs: readonly CareJob[]): CareJob[] {
  return [...jobs].sort((a, b) => {
    if (a.next_due !== b.next_due) {
      if (!a.next_due) return 1;
      if (!b.next_due) return -1;
      return a.next_due < b.next_due ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

export interface CareOverview {
  /** Active jobs due within 30 days, overdue included: the Hero number. */
  dueThisMonth: number;
  overdue: number;
  active: number;
  paused: number;
  hidden: number;
}

export function careOverview(jobs: readonly CareJob[], todayISO: string): CareOverview {
  const horizon = addDaysISO(todayISO, 30);
  let dueThisMonth = 0;
  let overdue = 0;
  let active = 0;
  let paused = 0;
  let hidden = 0;
  for (const j of jobs) {
    if (j.deleted) continue;
    if (j.state === 'paused') paused++;
    else if (j.state === 'hidden') hidden++;
    else {
      active++;
      if (j.next_due && j.next_due <= horizon) dueThisMonth++;
      if (j.next_due && j.next_due < todayISO) overdue++;
    }
  }
  return { dueThisMonth, overdue, active, paused, hidden };
}

/** The due list: active jobs split into due soon (overdue included) and later. */
export function careDueGroups(jobs: readonly CareJob[], todayISO: string): { soon: CareJob[]; later: CareJob[] } {
  const horizon = addDaysISO(todayISO, 30);
  const active = sortByDue(jobs.filter((j) => !j.deleted && j.state === 'active'));
  return {
    soon: active.filter((j) => j.next_due && j.next_due <= horizon),
    later: active.filter((j) => !j.next_due || j.next_due > horizon),
  };
}

export interface CareSeasonGroup {
  season: Season;
  /** "Sep to Nov". */
  months: string;
  /** The window, YYYY-MM-DD inclusive start, exclusive end. */
  from: string;
  to: string;
  current: boolean;
  jobs: CareJob[];
  /** Jobs done inside this window (current season only). */
  done: number;
}

/** The next four seasons from today, each with the active jobs due in it. Overdue jobs join the current season. */
export function careSeasonGroups(jobs: readonly CareJob[], todayISO: string, southern: boolean): CareSeasonGroup[] {
  const [y, m] = parts(todayISO);
  const current = seasonOfMonth(m, southern);
  // Walk back to the first month of the current season.
  let startMonth = m;
  let startYear = y;
  while (seasonOfMonth(startMonth === 1 ? 12 : startMonth - 1, southern) === current) {
    if (startMonth === 1) {
      startMonth = 12;
      startYear--;
    } else startMonth--;
  }
  let from = iso(startYear, startMonth, 1);
  const active = sortByDue(jobs.filter((j) => !j.deleted && j.state === 'active'));
  const groups: CareSeasonGroup[] = [];
  for (let i = 0; i < 4; i++) {
    const to = addMonthsISO(from, 3);
    const season = seasonOfMonth(parts(from)[1], southern);
    const first = i === 0;
    groups.push({
      season,
      months: seasonMonthsLabel(season, southern),
      from,
      to,
      current: first,
      jobs: active.filter((j) => !!j.next_due && j.next_due < to && (first || j.next_due >= from)),
      done: first
        ? jobs.filter((j) => !j.deleted && j.state === 'active' && j.done_log.some((e) => e.on >= from && e.on < to)).length
        : 0,
    });
    from = to;
  }
  return groups;
}

export interface CareRoomGroup {
  room: string;
  jobs: CareJob[];
  overdue: number;
  next: string | null;
}

/** Active jobs grouped by room, rooms with something overdue first, then by name. Jobs with no room go under "Whole house". */
export function careRoomGroups(jobs: readonly CareJob[], todayISO: string): CareRoomGroup[] {
  const map = new Map<string, CareJob[]>();
  for (const j of sortByDue(jobs.filter((j) => !j.deleted && j.state === 'active'))) {
    const room = j.room?.trim() || 'Whole house';
    map.set(room, [...(map.get(room) ?? []), j]);
  }
  return [...map.entries()]
    .map(([room, list]) => ({
      room,
      jobs: list,
      overdue: list.filter((j) => j.next_due && j.next_due < todayISO).length,
      next: list.find((j) => j.next_due)?.next_due ?? null,
    }))
    .sort((a, b) => (b.overdue > 0 ? 1 : 0) - (a.overdue > 0 ? 1 : 0) || a.room.localeCompare(b.room));
}

/** Rooms to offer in the job editor: the household's rooms first, then the usual ones. */
export function careRoomOptions(jobs: readonly CareJob[], setupRooms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...setupRooms, ...jobs.map((j) => j.room ?? ''), ...COMMON_ROOMS]) {
    const t = r.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

const COMMON_ROOMS = ['Whole house', 'Kitchen', 'Living', 'Bedrooms', 'Bathroom', 'Laundry', 'Hallway', 'Outside', 'Garage'];

// ── Doing a job ─────────────────────────────────────────────────────────────

/** Keep the history short: it is for "last done" and an undo, not an audit trail. */
export const CARE_LOG_MAX = 20;

/** The patch for finishing a job on `doneISO`. */
export function careDonePatch(job: CareJob, doneISO: string, by: string | null): Pick<CareJob, 'last_done' | 'next_due' | 'done_log'> {
  const entry: CareLogEntry = { on: doneISO, by, prev_due: job.next_due };
  return {
    last_done: doneISO,
    next_due: nextDueAfter(job, doneISO),
    done_log: [...job.done_log, entry].slice(-CARE_LOG_MAX),
  };
}

/** The patch that undoes the last finish. Null when there is nothing to undo. */
export function careUndoDonePatch(job: CareJob): Pick<CareJob, 'last_done' | 'next_due' | 'done_log'> | null {
  const last = job.done_log.at(-1);
  if (!last) return null;
  const log = job.done_log.slice(0, -1);
  return { last_done: log.at(-1)?.on ?? null, next_due: last.prev_due, done_log: log };
}

/** Skip this time: move to the following due date without logging it as done. */
export function careSkipPatch(job: CareJob, todayISO: string): Pick<CareJob, 'next_due'> {
  const from = job.next_due && job.next_due > todayISO ? job.next_due : todayISO;
  return { next_due: nextDueAfter(job, from) };
}

/** Push back by a few days or weeks. */
export function careSnoozePatch(job: CareJob, todayISO: string, days: number): Pick<CareJob, 'next_due'> {
  const from = job.next_due && job.next_due > todayISO ? job.next_due : todayISO;
  return { next_due: addDaysISO(from, days) };
}

export const CARE_SNOOZE_OPTIONS: readonly { days: number; label: string }[] = [
  { days: 7, label: 'A week' },
  { days: 14, label: 'Two weeks' },
  { days: 30, label: 'A month' },
];

export const CARE_REMIND_OPTIONS: readonly { days: number; label: string }[] = [
  { days: 0, label: 'On the day' },
  { days: 3, label: '3 days before' },
  { days: 7, label: 'A week before' },
  { days: 14, label: 'Two weeks before' },
];

// ── Suggestions ─────────────────────────────────────────────────────────────

export interface CareSuggestion {
  id: string;
  title: string;
  area: CareArea;
  room: string;
  every_n: number;
  every_unit: CareUnit;
  /** A once-a-year job before this season (the month is worked out per hemisphere). */
  before?: Season;
  /** Ticked in the first-run picker. Kept to a few, so nothing nags on day one. */
  preticked?: boolean;
  /** One line on why, shown under the suggestion. */
  why?: string;
  /** Only offered in these regions (ISO codes); everywhere when unset. */
  regions?: readonly string[];
}

export const CARE_AREAS: readonly { id: CareArea; label: string }[] = [
  { id: 'safety', label: 'Safety' },
  { id: 'climate', label: 'Heating and cooling' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'laundry', label: 'Laundry' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'outside', label: 'Outside' },
  { id: 'pool', label: 'Pool' },
  { id: 'garden', label: 'Garden' },
  { id: 'other', label: 'Other' },
];

export function careAreaLabel(area: CareArea): string {
  return CARE_AREAS.find((a) => a.id === area)?.label ?? 'Other';
}

// Intervals sit at the long end of the usual advice: a household can always
// make one more often, and a list that nags gets switched off.
export const CARE_SUGGESTIONS: readonly CareSuggestion[] = [
  { id: 'smoke-alarm-test', title: 'Test smoke alarms', area: 'safety', room: 'Whole house', every_n: 6, every_unit: 'month', preticked: true, why: 'Press the test button on each one.' },
  { id: 'smoke-alarm-battery', title: 'Replace smoke alarm batteries', area: 'safety', room: 'Whole house', every_n: 1, every_unit: 'year' },
  { id: 'safety-switch-test', title: 'Test safety switches', area: 'safety', room: 'Whole house', every_n: 6, every_unit: 'month', why: 'The RCD test button at the switchboard.' },
  { id: 'fire-extinguisher', title: 'Check the fire extinguisher and blanket', area: 'safety', room: 'Kitchen', every_n: 1, every_unit: 'year' },
  { id: 'aircon-filter', title: 'Clean aircon filters', area: 'climate', room: 'Living', every_n: 3, every_unit: 'month', preticked: true },
  { id: 'aircon-service', title: 'Service the air conditioner', area: 'climate', room: 'Whole house', every_n: 1, every_unit: 'year', before: 'summer' },
  { id: 'heater-service', title: 'Service the heater', area: 'climate', room: 'Whole house', every_n: 1, every_unit: 'year', before: 'winter' },
  { id: 'ceiling-fans', title: 'Dust the ceiling fans', area: 'climate', room: 'Bedrooms', every_n: 1, every_unit: 'year', before: 'summer' },
  { id: 'dishwasher-filter', title: 'Clean the dishwasher filter', area: 'kitchen', room: 'Kitchen', every_n: 3, every_unit: 'month' },
  { id: 'rangehood-filter', title: 'Clean the rangehood filter', area: 'kitchen', room: 'Kitchen', every_n: 6, every_unit: 'month' },
  { id: 'oven-clean', title: 'Clean the oven', area: 'kitchen', room: 'Kitchen', every_n: 6, every_unit: 'month' },
  { id: 'fridge-coils', title: 'Vacuum behind the fridge', area: 'kitchen', room: 'Kitchen', every_n: 1, every_unit: 'year' },
  { id: 'washer-clean', title: 'Run a washing machine clean cycle', area: 'laundry', room: 'Laundry', every_n: 3, every_unit: 'month' },
  { id: 'dryer-lint', title: 'Clear the dryer vent', area: 'laundry', room: 'Laundry', every_n: 6, every_unit: 'month' },
  { id: 'hot-water', title: 'Check the hot water system', area: 'plumbing', room: 'Outside', every_n: 1, every_unit: 'year', why: 'Look for leaks and test the relief valve.' },
  { id: 'shower-heads', title: 'Descale the shower heads', area: 'plumbing', room: 'Bathroom', every_n: 6, every_unit: 'month' },
  { id: 'gutters', title: 'Clear the gutters', area: 'outside', room: 'Outside', every_n: 1, every_unit: 'year', before: 'summer', why: 'Dry leaves in gutters are a fire risk in bushfire season.' },
  { id: 'termite-inspection', title: 'Book a termite inspection', area: 'outside', room: 'Outside', every_n: 1, every_unit: 'year', regions: ['AU'] },
  { id: 'windows-screens', title: 'Clean windows and fly screens', area: 'outside', room: 'Outside', every_n: 1, every_unit: 'year', before: 'spring' },
  { id: 'pool-fence', title: 'Check the pool fence and gate', area: 'pool', room: 'Outside', every_n: 3, every_unit: 'month', why: 'The gate should close and latch on its own.' },
  { id: 'pool-water', title: 'Test the pool water', area: 'pool', room: 'Outside', every_n: 2, every_unit: 'week' },
  { id: 'mower-service', title: 'Service the mower', area: 'garden', room: 'Outside', every_n: 1, every_unit: 'year', before: 'spring' },
  { id: 'sprinklers', title: 'Check the sprinklers and taps', area: 'garden', room: 'Outside', every_n: 1, every_unit: 'year', before: 'summer' },
];

/** Suggestions for a region. */
export function careSuggestionsFor(region: string | null | undefined): CareSuggestion[] {
  const r = (region ?? '').toUpperCase();
  return CARE_SUGGESTIONS.filter((s) => !s.regions || s.regions.includes(r));
}

/** Suggestions the household hasn't turned into a job (in any state), grouped by area. */
export function openSuggestionsByArea(
  jobs: readonly CareJob[],
  region: string | null | undefined,
): { area: CareArea; label: string; suggestions: CareSuggestion[] }[] {
  const taken = new Set(jobs.filter((j) => !j.deleted && j.suggestion_id).map((j) => j.suggestion_id));
  const open = careSuggestionsFor(region).filter((s) => !taken.has(s.id));
  return CARE_AREAS.map((a) => ({ area: a.id, label: a.label, suggestions: open.filter((s) => s.area === a.id) })).filter(
    (g) => g.suggestions.length > 0,
  );
}

/** The schedule fields a suggestion starts a job with. */
export function suggestionSchedule(
  s: CareSuggestion,
  southern: boolean,
): Pick<CareJob, 'every_n' | 'every_unit' | 'season_month'> {
  return {
    every_n: s.every_n,
    every_unit: s.every_unit,
    season_month: s.before ? monthBeforeSeason(s.before, southern) : null,
  };
}

/** A new job's row (without id, group or timestamps). */
export function newCareJobFields(
  input: {
    title: string;
    area?: CareArea;
    room?: string | null;
    suggestion_id?: string | null;
    every_n: number;
    every_unit: CareUnit;
    season_month?: number | null;
    state?: CareJobState;
  },
  todayISO: string,
): Omit<CareJob, 'id' | 'group_id' | 'created_by' | 'created_at' | 'updated_at' | 'deleted'> {
  const schedule = {
    every_n: Math.max(1, Math.round(input.every_n)),
    every_unit: input.every_unit,
    season_month: input.season_month ?? null,
  };
  const state = input.state ?? 'active';
  return {
    title: input.title.trim(),
    area: input.area ?? 'other',
    room: input.room?.trim() || null,
    suggestion_id: input.suggestion_id ?? null,
    state,
    ...schedule,
    next_due: state === 'active' ? firstDueDate(schedule, todayISO) : null,
    last_done: null,
    assigned_to: null,
    remind: true,
    remind_days_before: 0,
    notes: null,
    done_log: [],
  };
}

/** The job fields for a suggestion, as the picker saves it. */
export function careJobFromSuggestion(
  s: CareSuggestion,
  southern: boolean,
  todayISO: string,
  state: CareJobState = 'active',
): ReturnType<typeof newCareJobFields> {
  return newCareJobFields(
    { title: s.title, area: s.area, room: s.room, suggestion_id: s.id, ...suggestionSchedule(s, southern), state },
    todayISO,
  );
}

/** Patch for switching a job's state. Resuming gives it a due date again if it lost one. */
export function careStatePatch(job: CareJob, state: CareJobState, todayISO: string): Partial<CareJob> {
  if (state === 'active') {
    const next_due = job.next_due && job.next_due >= todayISO ? job.next_due : firstDueDate(job, todayISO);
    return { state, next_due };
  }
  return { state };
}
