// Pure decision helpers for use-update-toasts.ts, split out so vitest can
// cover them without pulling in expo-updates or @homeup/ui.

/** kv-store key holding the update id the user was last told they are running. */
export const LAST_SEEN_UPDATE_KEY = 'homeup_last_seen_update_v1';

/** Marker stored when the running bundle is the one embedded in the APK. */
export const EMBEDDED_MARKER = 'embedded';

export interface RunningBundle {
  isEmbeddedLaunch: boolean;
  updateId?: string | null;
}

/**
 * What to remember for the running bundle, and whether this launch is the
 * first one on a freshly applied OTA (so the "App updated" toast fires once
 * per update, never on a plain relaunch or a factory bundle).
 */
export function resolveLaunch(
  lastSeen: string | null,
  running: RunningBundle,
): { remember: string; announceApplied: boolean } {
  if (running.isEmbeddedLaunch || !running.updateId) {
    return { remember: EMBEDDED_MARKER, announceApplied: false };
  }
  return { remember: running.updateId, announceApplied: lastSeen !== running.updateId };
}

/** One-line description for the "App updated" toast. */
export function appliedDescription(commitSha: string | null | undefined): string {
  const short = commitSha?.slice(0, 7);
  return short ? `Now running ${short}.` : 'Now running the latest version.';
}

/** Minimum gap between foreground update checks, so quick app switches don't re-check. */
export const RESUME_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Whether returning to the foreground should check for an update. */
export function shouldCheckOnResume(lastCheckMs: number | null, nowMs: number): boolean {
  return lastCheckMs === null || nowMs - lastCheckMs >= RESUME_CHECK_INTERVAL_MS;
}
