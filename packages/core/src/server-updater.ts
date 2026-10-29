// One-click updates for a self-hosted server (scripts/updater/). The updater
// runs on the host, outside Docker. The app only drops a version number in
// its inbox and reads the progress it writes (updates/state/status.json).
// GET /api/server-update carries that progress as `updater`; an older server
// sends none, and the panel falls back to the manual steps.

import { timeAgo } from './relative-time';
import type { ServerUpdate } from './app-release';

export type UpdaterStep = 'check' | 'backup' | 'download' | 'build' | 'restart' | 'health' | 'rollback' | 'done';
export type UpdaterRunState = 'running' | 'done' | 'failed' | 'rolled-back';

/** The last update run, as the updater wrote it. */
export interface UpdaterStatus {
  state: UpdaterRunState;
  /** The version the server ran before. */
  from: string | null;
  /** The version the run installs. */
  target: string | null;
  step: UpdaterStep;
  /** Where a failed run stopped. */
  failedStep: UpdaterStep | null;
  /** Plain-language reason for a failed or rolled-back run. */
  message: string | null;
  /** The database was put back from the backup taken before the update. */
  dataRestored: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
}

export interface ServerUpdater {
  /** The operator ran scripts/updater/install.sh. */
  installed: boolean;
  /** An Update press waits for the updater to pick it up. */
  pending: boolean;
  /** When that press was made. */
  pendingSince: string | null;
  status: UpdaterStatus | null;
}

/** What the operator runs once to turn one-click updates on. */
export const SERVER_UPDATER_INSTALL_COMMAND = './scripts/updater/install.sh';

/** A run rewrites its status every minute; one silent for this long has stopped (the host rebooted, say). */
export const UPDATER_STALE_MS = 15 * 60 * 1000;
/** The updater picks a request up at once (systemd) or within a minute (cron); one waiting longer was never seen. */
export const UPDATER_PICKUP_MS = 3 * 60 * 1000;
/** How long the result of a finished run stays on the panel. */
export const UPDATER_RESULT_MS = 24 * 60 * 60 * 1000;
/** How often an open panel asks for progress while an update runs. */
export const UPDATER_POLL_MS = 4000;

const STEPS: readonly UpdaterStep[] = ['check', 'backup', 'download', 'build', 'restart', 'health', 'rollback', 'done'];
const STATES: readonly UpdaterRunState[] = ['running', 'done', 'failed', 'rolled-back'];
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

function str(v: unknown, max = 600): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}
function version(v: unknown): string | null {
  return typeof v === 'string' && VERSION.test(v) ? v : null;
}
function step(v: unknown): UpdaterStep | null {
  return typeof v === 'string' && (STEPS as readonly string[]).includes(v) ? (v as UpdaterStep) : null;
}

/** A status.json as the updater wrote it, or null when it is not one. */
export function cleanUpdaterStatus(raw: unknown): UpdaterStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const state = typeof r.state === 'string' && (STATES as readonly string[]).includes(r.state) ? (r.state as UpdaterRunState) : null;
  if (!state) return null;
  return {
    state,
    from: version(r.from),
    target: version(r.target),
    step: step(r.step) ?? 'check',
    failedStep: step(r.failedStep),
    message: str(r.message),
    dataRestored: r.dataRestored === true,
    startedAt: str(r.startedAt, 40),
    updatedAt: str(r.updatedAt, 40),
    finishedAt: str(r.finishedAt, 40),
  };
}

/** The `updater` field of GET /api/server-update, or null from a server without one. */
export function cleanServerUpdater(raw: unknown): ServerUpdater | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pending = r.pending === true;
  return { installed: r.installed === true, pending, pendingSince: pending ? str(r.pendingSince, 40) : null, status: cleanUpdaterStatus(r.status) };
}

function time(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** The status as the panel should read it: a run that stopped writing counts as failed. */
export function currentUpdaterStatus(status: UpdaterStatus | null, now = Date.now()): UpdaterStatus | null {
  if (!status || status.state !== 'running') return status;
  if (now - time(status.updatedAt ?? status.startedAt) < UPDATER_STALE_MS) return status;
  return {
    ...status,
    state: 'failed',
    failedStep: status.step,
    message: 'The updater stopped answering. The log on the server is updates/state/update.log.',
    finishedAt: status.updatedAt,
  };
}

/** A press the updater never picked up: it is not running on the host. */
export function updaterRequestStuck(updater: ServerUpdater | null | undefined, now = Date.now()): boolean {
  return !!updater?.pending && !!updater.pendingSince && now - time(updater.pendingSince) >= UPDATER_PICKUP_MS;
}

export type ServerUpdatePanelKind = 'manual' | 'ready' | 'running' | 'done' | 'failed' | 'rolled-back' | 'stuck';

/** Which panel the operator sees, or null for none. */
export function serverUpdatePanelKind(
  update: ServerUpdate | null | undefined,
  updater: ServerUpdater | null | undefined,
  now = Date.now(),
): ServerUpdatePanelKind | null {
  const status = currentUpdaterStatus(updater?.status ?? null, now);
  if (updaterRequestStuck(updater, now)) return 'stuck';
  if (updater?.pending || status?.state === 'running') return 'running';
  const recent = status && now - time(status.finishedAt) < UPDATER_RESULT_MS;
  if (recent && status.state === 'done' && !update) return 'done';
  if (recent && (status.state === 'failed' || status.state === 'rolled-back')) return status.state;
  if (update) return updater?.installed ? 'ready' : 'manual';
  return null;
}

export type UpdaterStepState = 'done' | 'run' | 'todo' | 'fail';
export interface UpdaterStepRow {
  id: UpdaterStep;
  label: string;
  state: UpdaterStepState;
}

/** The steps a run shows, with how far it got. */
export function updaterStepRows(status: UpdaterStatus | null, pending = false): UpdaterStepRow[] {
  const target = status?.target ?? 'the release';
  const rows: { id: UpdaterStep; label: string }[] = [
    { id: 'backup', label: 'Back up' },
    { id: 'download', label: `Get ${target}` },
    { id: 'build', label: 'Build' },
    { id: 'restart', label: 'Restart' },
    { id: 'health', label: 'Check it works' },
  ];
  const order = rows.map((r) => r.id);
  if (pending || !status) return rows.map((r) => ({ ...r, state: 'todo' }));
  if (status.state === 'done') return rows.map((r) => ({ ...r, state: 'done' }));

  const failedAt = status.state === 'running' && status.step !== 'rollback' ? null : (status.failedStep ?? status.step);
  const stopAt = failedAt ?? status.step;
  const index = order.indexOf(stopAt);
  if (failedAt && index < 0) return [];
  const out: UpdaterStepRow[] = rows.map((r, i) => {
    let state: UpdaterStepState = 'todo';
    if (index >= 0 && i < index) state = 'done';
    else if (i === index) state = failedAt ? 'fail' : 'run';
    return { ...r, state };
  });
  if (failedAt) {
    // A run that stopped before step 3 changed nothing; past that it went back.
    const wentBack = status.step === 'rollback' || status.state === 'rolled-back';
    if (wentBack) {
      out.splice(index + 1);
      out.push({
        id: 'rollback',
        label: `Go back to ${status.from ?? 'the old version'}`,
        state: status.state === 'running' ? 'run' : status.state === 'rolled-back' ? 'done' : 'fail',
      });
    } else {
      out.splice(index + 1);
    }
  }
  return out;
}

export interface ServerUpdatePanelCopy {
  title: string;
  subtitle: string | null;
  body: string | null;
}

/** The copy for each panel, the same on web and phone. */
export function serverUpdatePanelCopy(
  kind: ServerUpdatePanelKind,
  update: ServerUpdate | null | undefined,
  updater: ServerUpdater | null | undefined,
  now = Date.now(),
): ServerUpdatePanelCopy {
  const status = currentUpdaterStatus(updater?.status ?? null, now);
  const latest = update?.latest ?? status?.target ?? 'the new version';
  const current = update?.current ?? status?.from ?? 'the old version';
  switch (kind) {
    case 'manual':
      return {
        title: `Rooftap ${latest} is out`,
        subtitle: `Your server runs ${current}`,
        body: 'Turn on one-click updates by running this once in the server’s Rooftap folder:',
      };
    case 'ready':
      return {
        title: 'Update ready',
        subtitle: `Your server runs ${current}`,
        body: `Rooftap backs up first and goes back to ${current} if anything fails. The app is offline for about a minute near the end.`,
      };
    case 'running':
      return {
        title: `Updating to ${status?.target ?? latest}`,
        subtitle: updater?.pending ? 'Waiting for the server to start' : startedLabel(status?.startedAt ?? null),
        body: 'You can close this. The server finishes on its own.',
      };
    case 'done':
      return {
        title: 'Server is up to date',
        subtitle: finishedLabel('Updated', status?.finishedAt ?? null),
        body: null,
      };
    case 'rolled-back':
      return {
        title: `Update to ${status?.target ?? latest} failed`,
        subtitle: finishedLabel(`Back on ${status?.from ?? current}`, status?.finishedAt ?? null),
        body: [status?.message, status?.dataRestored ? 'Your data is as it was before the update.' : null].filter(Boolean).join(' ') || null,
      };
    case 'stuck':
      return {
        title: 'The update did not start',
        subtitle: `Your server runs ${current}`,
        body: `The updater on the server did not pick up the request. Run ${SERVER_UPDATER_INSTALL_COMMAND} again in the server\u2019s Rooftap folder, then try again.`,
      };
    case 'failed':
      return {
        title: `Update to ${status?.target ?? latest} failed`,
        subtitle: finishedLabel('Stopped', status?.finishedAt ?? null),
        body: status?.message ?? null,
      };
  }
}

function startedLabel(iso: string | null): string | null {
  const ago = timeAgo(iso);
  return ago ? `Started ${ago === 'Just now' ? 'just now' : ago}` : null;
}
function finishedLabel(prefix: string, iso: string | null): string {
  const ago = timeAgo(iso);
  return ago ? `${prefix} ${ago === 'Just now' ? 'just now' : ago}` : prefix;
}
