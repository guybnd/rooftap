// Recipes v2 R2: running cooks and their timers.
//
// A cook is one person cooking one recipe: a `cook_sessions` row with the
// step they are on and the timers they started. Several cooks run side by
// side (Guy: "several recipes running at once"). Rows are the person's own
// (RLS), so web and phone show the same cooks for them.
//
// A timer stores when it ends (`endsAt`), never a ticking counter, so it
// keeps time with the app closed. A paused timer stores what was left. A
// timer rings only on the device that started it (`deviceId`): the phone of
// the person who set it.
//
// Everything here is pure: callers pass `now` and write the returned row.

import { envRandomUUID } from '../../data/store-environment';
import type { RecipeStep } from '../../types';
import { formatCountdown } from './steps';

export interface CookTimer {
  id: string;
  /** The step the timer belongs to, and its place among that step's timers. */
  step: number;
  index: number;
  label: string;
  /** The timer's full length, for the ring. Grows with +1 min. */
  seconds: number;
  /** When it ends (ISO), while running. Null while paused. */
  endsAt: string | null;
  /** Milliseconds left, while paused. Null while running. */
  pausedRemaining: number | null;
  /** The device that started it, and so rings for it. */
  deviceId: string | null;
}

export interface CookSession {
  id: string;
  group_id: string;
  user_id: string | null;
  recipe_id: string;
  /** 0-based step the cook is on. */
  step: number;
  timers: CookTimer[];
  started_at: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export type CookTimerState = 'running' | 'paused' | 'done';

export function buildCookSession(input: { groupId: string; userId: string | null; recipeId: string; id?: string }): CookSession {
  const now = new Date().toISOString();
  return {
    id: input.id ?? envRandomUUID(),
    group_id: input.groupId,
    user_id: input.userId,
    recipe_id: input.recipeId,
    step: 0,
    timers: [],
    started_at: now,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

/** The cook's timers, tolerating a malformed jsonb value. */
export function cookTimers(session: Pick<CookSession, 'timers'>): CookTimer[] {
  return Array.isArray(session.timers) ? session.timers.filter((t) => t && typeof t.id === 'string') : [];
}

export function timerRemainingMs(timer: CookTimer, now: number): number {
  if (timer.pausedRemaining != null) return Math.max(0, timer.pausedRemaining);
  if (!timer.endsAt) return 0;
  return Math.max(0, Date.parse(timer.endsAt) - now);
}

export function timerState(timer: CookTimer, now: number): CookTimerState {
  if (timer.pausedRemaining != null) return 'paused';
  return timerRemainingMs(timer, now) > 0 ? 'running' : 'done';
}

/** How far through the timer is, 0 to 1, for its ring. */
export function timerProgress(timer: CookTimer, now: number): number {
  const total = timer.seconds * 1000;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - timerRemainingMs(timer, now) / total));
}

/** The timer started from a step's timer chip, if it is on this cook. */
export function findStepTimer(session: Pick<CookSession, 'timers'>, step: number, index: number): CookTimer | null {
  return cookTimers(session).find((t) => t.step === step && t.index === index) ?? null;
}

/**
 * Start a step's timer. A timer already running or paused for the same
 * chip is left alone; a finished one starts again.
 */
export function startTimer(
  timers: CookTimer[],
  input: { step: number; index: number; label: string; seconds: number },
  deviceId: string | null,
  now: number,
): CookTimer[] {
  const existing = timers.find((t) => t.step === input.step && t.index === input.index);
  if (existing && timerState(existing, now) !== 'done') return timers;
  const timer: CookTimer = {
    id: existing?.id ?? envRandomUUID(),
    step: input.step,
    index: input.index,
    label: input.label,
    seconds: input.seconds,
    endsAt: new Date(now + input.seconds * 1000).toISOString(),
    pausedRemaining: null,
    deviceId,
  };
  return existing ? timers.map((t) => (t.id === existing.id ? timer : t)) : [...timers, timer];
}

function mapTimer(timers: CookTimer[], id: string, fn: (t: CookTimer) => CookTimer): CookTimer[] {
  return timers.map((t) => (t.id === id ? fn(t) : t));
}

export function pauseTimer(timers: CookTimer[], id: string, now: number): CookTimer[] {
  return mapTimer(timers, id, (t) =>
    timerState(t, now) === 'running' ? { ...t, endsAt: null, pausedRemaining: timerRemainingMs(t, now) } : t,
  );
}

/** Resume a paused timer. The device that resumes it rings for it. */
export function resumeTimer(timers: CookTimer[], id: string, deviceId: string | null, now: number): CookTimer[] {
  return mapTimer(timers, id, (t) =>
    t.pausedRemaining == null
      ? t
      : { ...t, endsAt: new Date(now + t.pausedRemaining).toISOString(), pausedRemaining: null, deviceId },
  );
}

/** +1 min: a finished timer starts again with a minute on it. */
export function addTimerMinute(timers: CookTimer[], id: string, deviceId: string | null, now: number): CookTimer[] {
  return mapTimer(timers, id, (t) => {
    if (t.pausedRemaining != null) return { ...t, pausedRemaining: t.pausedRemaining + 60_000, seconds: t.seconds + 60 };
    const base = Math.max(now, t.endsAt ? Date.parse(t.endsAt) : now);
    const done = timerState(t, now) === 'done';
    return {
      ...t,
      endsAt: new Date(base + 60_000).toISOString(),
      seconds: done ? 60 : t.seconds + 60,
      deviceId: done ? deviceId : t.deviceId,
    };
  });
}

/** Stop a timer, or dismiss a finished one. */
export function stopTimer(timers: CookTimer[], id: string): CookTimer[] {
  return timers.filter((t) => t.id !== id);
}

export function clampStep(step: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.min(Math.max(0, Math.round(step)), stepCount - 1);
}

export interface NearestTimer {
  timer: CookTimer;
  state: CookTimerState;
  remainingMs: number;
}

/**
 * The timer that matters most: a finished one first (it is ringing), then
 * the running one with the least time left, then a paused one.
 */
export function nearestTimer(session: Pick<CookSession, 'timers'>, now: number): NearestTimer | null {
  const rank: Record<CookTimerState, number> = { done: 0, running: 1, paused: 2 };
  const all = cookTimers(session).map((timer) => ({
    timer,
    state: timerState(timer, now),
    remainingMs: timerRemainingMs(timer, now),
  }));
  all.sort((a, b) => rank[a.state] - rank[b.state] || a.remainingMs - b.remainingMs);
  return all[0] ?? null;
}

/** A head's badge: the nearest timer's countdown, else the step ("2/3"). */
export function cookBadge(session: Pick<CookSession, 'timers' | 'step'>, stepCount: number, now: number): {
  text: string;
  tone: 'done' | 'running' | 'paused' | 'step';
} {
  const near = nearestTimer(session, now);
  if (near) return { text: formatCountdown(near.remainingMs), tone: near.state };
  return { text: stepCount ? `${clampStep(session.step, stepCount) + 1}/${stepCount}` : '0/0', tone: 'step' };
}

/** The nearest timer across every running cook, for the web tab title. */
export function nearestAcrossCooks(sessions: readonly Pick<CookSession, 'timers'>[], now: number): NearestTimer | null {
  let best: NearestTimer | null = null;
  const rank: Record<CookTimerState, number> = { done: 0, running: 1, paused: 2 };
  for (const s of sessions) {
    const n = nearestTimer(s, now);
    if (!n) continue;
    if (!best || rank[n.state] - rank[best.state] < 0 || (n.state === best.state && n.remainingMs < best.remainingMs)) best = n;
  }
  return best;
}

/** Two letters for a head: "Lemon risotto" is LR, "Dal" is DA. */
export function cookInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Timers this device should ring for: running, started here. Each with
 * when it ends, for a scheduled notification or an in-tab alarm.
 */
export function timersToRing(
  sessions: readonly CookSession[],
  deviceId: string,
): { timer: CookTimer; session: CookSession; endsAt: number }[] {
  const out: { timer: CookTimer; session: CookSession; endsAt: number }[] = [];
  for (const session of sessions) {
    if (session.deleted) continue;
    for (const timer of cookTimers(session)) {
      if (timer.deviceId !== deviceId || timer.pausedRemaining != null || !timer.endsAt) continue;
      out.push({ timer, session, endsAt: Date.parse(timer.endsAt) });
    }
  }
  return out;
}

/** The step's timer chips with what each one is doing on this cook. */
export function stepTimerStates(
  session: Pick<CookSession, 'timers'> | null,
  step: RecipeStep,
  stepIndex: number,
  now: number,
): { label: string; seconds: number; index: number; running: NearestTimer | null }[] {
  return step.timers.map((t, index) => {
    const timer = session ? findStepTimer(session, stepIndex, index) : null;
    return {
      label: t.label,
      seconds: t.seconds,
      index,
      running: timer ? { timer, state: timerState(timer, now), remainingMs: timerRemainingMs(timer, now) } : null,
    };
  });
}

/** Notification copy for a finished timer. */
export function timerDoneText(timer: Pick<CookTimer, 'label'>, recipeTitle: string): { title: string; body: string } {
  return { title: `${timer.label} is done`, body: recipeTitle };
}

// ── Cooking heads (R3) ──────────────────────────────────────────────────────

/** Where the heads rest: an edge, and the top head's height as a share of the screen. */
export interface HeadDock {
  side: 'left' | 'right';
  y: number;
}

export const DEFAULT_HEAD_DOCK: HeadDock = { side: 'right', y: 0.38 };

/** From three cooks on, the heads stack into one pile. */
export const HEADS_STACK_AT = 3;

/** The size of a head and the gap between heads, in px. */
export const HEAD_SIZE = 56;
export const HEAD_GAP = 22;

/** Snap a dropped head to the nearest side edge, kept clear of the top and bottom bars. */
export function snapHeadDock(centerX: number, centerY: number, viewW: number, viewH: number): HeadDock {
  const y = viewH > 0 ? centerY / viewH : DEFAULT_HEAD_DOCK.y;
  return { side: centerX < viewW / 2 ? 'left' : 'right', y: Math.min(0.78, Math.max(0.1, y)) };
}

/** Read a stored dock, falling back to the default for anything malformed. */
export function parseHeadDock(raw: string | null | undefined): HeadDock {
  if (!raw) return DEFAULT_HEAD_DOCK;
  try {
    const v = JSON.parse(raw) as Partial<HeadDock>;
    if ((v.side === 'left' || v.side === 'right') && typeof v.y === 'number' && Number.isFinite(v.y)) {
      return { side: v.side, y: Math.min(0.78, Math.max(0.1, v.y)) };
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_HEAD_DOCK;
}

/** The stop target's centre: bottom middle, above the tab bar. */
export function stopTargetCenter(viewW: number, viewH: number, bottomInset: number): { x: number; y: number } {
  return { x: viewW / 2, y: viewH - bottomInset - 64 };
}

/** Whether a dragged head's centre is over the stop target. */
export function overStopTarget(centerX: number, centerY: number, viewW: number, viewH: number, bottomInset: number): boolean {
  const c = stopTargetCenter(viewW, viewH, bottomInset);
  return Math.hypot(centerX - c.x, centerY - c.y) < 60;
}

// ── Cook mode (R4) ──────────────────────────────────────────────────────────

/** Cook mode's route, the same on web and the app. */
export function cookModeHref(recipeId: string): string {
  return `/recipes/cook/${recipeId}`;
}

/** Whether a path is cook mode, where the heads step aside. */
export function isCookModePath(pathname: string | null | undefined): boolean {
  return !!pathname && /^\/recipes\/cook\/[^/]+\/?$/.test(pathname);
}

/** What read-aloud says for a step: its number, then its text. */
export function stepSpeech(stepIndex: number, stepCount: number, text: string): string {
  return stepCount > 1 ? `Step ${stepIndex + 1}. ${text}` : text;
}
