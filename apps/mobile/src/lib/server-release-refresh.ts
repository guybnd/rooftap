// Asks the server again which phone release is newest (core app-release.ts).
// The data cache asks once at launch, but Android keeps the app alive for
// days, so a release published after launch went unseen until a cold start.
// So "Check for updates" asks too, and so does the app each time it comes
// back to the foreground, at most once every half hour.
import { serverReleaseFromConfig, setServerRelease } from '@homeup/core';
import { fetchPublicConfig, getStoredServer } from './server-config';

const FOREGROUND_GAP_MS = 30 * 60 * 1000;
let lastAt = 0;

/** Re-reads the server's release info. Resolves false when the server could not be reached. */
export async function refreshServerRelease(): Promise<boolean> {
  const server = await getStoredServer();
  if (!server) return false;
  try {
    const config = await fetchPublicConfig(server.origin, 8000);
    lastAt = Date.now();
    setServerRelease(serverReleaseFromConfig(config));
    return true;
  } catch {
    return false;
  }
}

/** The foreground check: skipped when the last one was recent. */
export function refreshServerReleaseIfStale(now = Date.now()): void {
  if (now - lastAt < FOREGROUND_GAP_MS) return;
  lastAt = now;
  void refreshServerRelease();
}
