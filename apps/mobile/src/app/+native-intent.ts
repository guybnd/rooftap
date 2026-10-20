// HOUP-148: expo-share-intent's Android module relaunches the app via a
// custom-scheme deep link carrying the share payload (`dataUrl=<key>`).
// Without this redirect, expo-router would try to resolve that raw path as
// a route and 404 on cold start. Redirecting home is safe regardless of
// auth state — <ShareIntentHandler/> is mounted in the root layout (so it
// runs on every route) and drains the pending intent once expo-share-intent
// finishes parsing it, then pushes to the real destination screen.
import { getShareExtensionKey } from 'expo-share-intent';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
    return '/';
  }
  return path;
}
