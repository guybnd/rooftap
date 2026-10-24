import type { WebHere } from '@homeup/core';

// Where the phone is, for a "near me" ask (core looksNearby). Asks for
// when-in-use permission once. A fix stays good for a few minutes, so a
// follow-up in the same chat answers at once. Right after the permission
// prompt Android often has no last known fix and a fresh one can take a
// while indoors, so the wait is generous and an older fix is the fallback.
// Null when there is no permission or no fix; the server then starts from
// the household's home.

const FRESH_MS = 10 * 60_000;
const STALE_MS = 60 * 60_000;
const TIMEOUT_MS = 15_000;

let last: { at: number; here: WebHere } | null = null;

export async function devicePosition(): Promise<WebHere | null> {
  if (last && Date.now() - last.at < FRESH_MS) return last.here;
  try {
    const Location = await import('expo-location');
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const recent = await Location.getLastKnownPositionAsync({ maxAge: FRESH_MS, requiredAccuracy: 2000 }).catch(() => null);
    const fix =
      recent ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
      ])) ??
      (await Location.getLastKnownPositionAsync({ maxAge: STALE_MS }).catch(() => null));
    if (!fix) return null;
    const here = { lat: fix.coords.latitude, lng: fix.coords.longitude };
    last = { at: Date.now(), here };
    return here;
  } catch {
    return null;
  }
}
