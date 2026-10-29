import { describe, expect, it } from 'vitest';
import {
  cleanServerUpdater,
  cleanUpdaterStatus,
  currentUpdaterStatus,
  serverUpdatePanelCopy,
  serverUpdatePanelKind,
  updaterStepRows,
  UPDATER_PICKUP_MS,
  UPDATER_STALE_MS,
  type UpdaterStatus,
} from './server-updater';

const NOW = Date.parse('2026-10-29T21:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const update = { current: '1.1.3', latest: '1.2.0', url: 'https://github.com/guybnd/rooftap/releases/tag/v1.2.0' };

function status(over: Partial<UpdaterStatus>): UpdaterStatus {
  return {
    state: 'running',
    from: '1.1.3',
    target: '1.2.0',
    step: 'build',
    failedStep: null,
    message: null,
    dataRestored: false,
    startedAt: ago(60_000),
    updatedAt: ago(10_000),
    finishedAt: null,
    ...over,
  };
}

describe('cleanUpdaterStatus', () => {
  it('keeps a status the updater wrote and drops anything else', () => {
    expect(cleanUpdaterStatus({ state: 'done', step: 'done', target: '1.2.0', from: '1.1.3', dataRestored: true })).toMatchObject({
      state: 'done',
      target: '1.2.0',
      dataRestored: true,
    });
    expect(cleanUpdaterStatus({ state: 'exploded' })).toBeNull();
    expect(cleanUpdaterStatus('running')).toBeNull();
    expect(cleanUpdaterStatus({ state: 'running', step: 'nope', target: '../../etc' })).toMatchObject({ step: 'check', target: null });
  });

  it('reads an older server with no updater as none', () => {
    expect(cleanServerUpdater(undefined)).toBeNull();
    expect(cleanServerUpdater({ installed: true })).toEqual({ installed: true, pending: false, pendingSince: null, status: null });
  });
});

describe('currentUpdaterStatus', () => {
  it('counts a run that stopped writing as failed', () => {
    const stale = status({ updatedAt: ago(UPDATER_STALE_MS + 1) });
    expect(currentUpdaterStatus(stale, NOW)).toMatchObject({ state: 'failed', failedStep: 'build' });
    expect(currentUpdaterStatus(status({}), NOW)?.state).toBe('running');
  });
});

describe('serverUpdatePanelKind', () => {
  it('shows the manual steps until the updater is on, then the button', () => {
    expect(serverUpdatePanelKind(update, null, NOW)).toBe('manual');
    expect(serverUpdatePanelKind(update, { installed: false, pending: false, pendingSince: null, status: null }, NOW)).toBe('manual');
    expect(serverUpdatePanelKind(update, { installed: true, pending: false, pendingSince: null, status: null }, NOW)).toBe('ready');
    expect(serverUpdatePanelKind(null, { installed: true, pending: false, pendingSince: null, status: null }, NOW)).toBeNull();
  });

  it('follows a run, and shows its result for a day', () => {
    const on = { installed: true, pending: false, pendingSince: null };
    expect(serverUpdatePanelKind(update, { ...on, pending: true, pendingSince: ago(30_000), status: null }, NOW)).toBe('running');
    // A press nobody picked up: the updater is not running on the host.
    expect(serverUpdatePanelKind(update, { ...on, pending: true, pendingSince: ago(UPDATER_PICKUP_MS), status: null }, NOW)).toBe('stuck');
    expect(serverUpdatePanelKind(update, { ...on, status: status({}) }, NOW)).toBe('running');
    const done = status({ state: 'done', step: 'done', finishedAt: ago(60_000) });
    expect(serverUpdatePanelKind(null, { ...on, status: done }, NOW)).toBe('done');
    const rolled = status({ state: 'rolled-back', step: 'rollback', failedStep: 'build', finishedAt: ago(60_000) });
    expect(serverUpdatePanelKind(update, { ...on, status: rolled }, NOW)).toBe('rolled-back');
    const old = status({ state: 'rolled-back', finishedAt: ago(2 * 24 * 3600_000) });
    expect(serverUpdatePanelKind(update, { ...on, status: old }, NOW)).toBe('ready');
  });
});

describe('updaterStepRows', () => {
  it('marks the steps done up to the one running', () => {
    expect(updaterStepRows(status({ step: 'build' })).map((r) => r.state)).toEqual(['done', 'done', 'run', 'todo', 'todo']);
    expect(updaterStepRows(null, true).every((r) => r.state === 'todo')).toBe(true);
  });

  it('shows where a run failed and the way back', () => {
    const rows = updaterStepRows(status({ state: 'rolled-back', step: 'rollback', failedStep: 'build' }));
    expect(rows.map((r) => [r.label, r.state])).toEqual([
      ['Back up', 'done'],
      ['Get 1.2.0', 'done'],
      ['Build', 'fail'],
      ['Go back to 1.1.3', 'done'],
    ]);
    expect(updaterStepRows(status({ state: 'failed', step: 'backup', failedStep: 'backup' })).map((r) => r.state)).toEqual(['fail']);
    expect(updaterStepRows(status({ state: 'failed', step: 'check', failedStep: 'check' }))).toEqual([]);
  });
});

describe('serverUpdatePanelCopy', () => {
  it('names the versions and says the old one comes back', () => {
    const on = { installed: true, pending: false, pendingSince: null, status: null };
    expect(serverUpdatePanelCopy('ready', update, on, NOW).body).toContain('goes back to 1.1.3');
    const rolled = status({ state: 'rolled-back', message: '1.2.0 did not build.', dataRestored: true, finishedAt: new Date().toISOString() });
    const copy = serverUpdatePanelCopy('rolled-back', update, { ...on, status: rolled }, NOW);
    expect(copy.title).toBe('Update to 1.2.0 failed');
    expect(copy.body).toBe('1.2.0 did not build. Your data is as it was before the update.');
    for (const c of [copy, serverUpdatePanelCopy('manual', update, on, NOW)]) {
      expect(`${c.title} ${c.subtitle} ${c.body}`).not.toMatch(/—/);
    }
  });
});
