import { describe, expect, it } from 'vitest';
import {
  EMBEDDED_MARKER,
  RESUME_CHECK_INTERVAL_MS,
  appliedDescription,
  resolveLaunch,
  shouldCheckOnResume,
} from './update-toast-logic';

describe('resolveLaunch', () => {
  it('announces the first launch on a new OTA', () => {
    expect(resolveLaunch('old-id', { isEmbeddedLaunch: false, updateId: 'new-id' })).toEqual({
      remember: 'new-id',
      announceApplied: true,
    });
  });

  it('announces an OTA when nothing was remembered yet', () => {
    expect(resolveLaunch(null, { isEmbeddedLaunch: false, updateId: 'new-id' }).announceApplied).toBe(true);
  });

  it('stays quiet on a relaunch of the same OTA', () => {
    expect(resolveLaunch('same', { isEmbeddedLaunch: false, updateId: 'same' }).announceApplied).toBe(false);
  });

  it('stays quiet on the factory bundle and remembers it', () => {
    expect(resolveLaunch('old-id', { isEmbeddedLaunch: true, updateId: 'whatever' })).toEqual({
      remember: EMBEDDED_MARKER,
      announceApplied: false,
    });
  });
});

describe('appliedDescription', () => {
  it('shows the short commit when CI inlined one', () => {
    expect(appliedDescription('19ce601abcdef')).toBe('Now running 19ce601.');
  });

  it('falls back when no commit is known', () => {
    expect(appliedDescription(undefined)).toBe('Now running the latest version.');
  });
});

describe('shouldCheckOnResume', () => {
  it('checks on the first resume', () => {
    expect(shouldCheckOnResume(null, 1000)).toBe(true);
  });

  it('skips a resume inside the interval', () => {
    expect(shouldCheckOnResume(1000, 1000 + RESUME_CHECK_INTERVAL_MS - 1)).toBe(false);
  });

  it('checks again once the interval has passed', () => {
    expect(shouldCheckOnResume(1000, 1000 + RESUME_CHECK_INTERVAL_MS)).toBe(true);
  });
});
