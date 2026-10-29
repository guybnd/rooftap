import Constants from 'expo-constants';

/**
 * The short main-branch commit this bundle was built from, or null on local
 * and factory builds. CI sets it in the update's manifest (app.config.ts
 * `extra.gitSha`), so it answers "which merge am I running?" on About &
 * updates, in the "App updated" toast and in crash reports.
 */
export function buildCommit(): string | null {
  const sha = Constants.expoConfig?.extra?.gitSha;
  return typeof sha === 'string' && sha ? sha.slice(0, 7) : null;
}
