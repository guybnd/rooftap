import type { WebHere } from '@homeup/core';

// Where the phone is, for an Assistant "near me" ask. Android asks the person
// the first time; once they say no for good, it isn't asked again. A no, no
// fix within a few seconds, or a build without the location module resolves
// null, and the message goes without it. expo-location loads only when
// needed, so the rest of the app never touches it.
const TIMEOUT_MS = 8000;

export async function devicePosition(): Promise<WebHere | null> {
  try {
    const Location = await import('expo-location');
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const recent = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 500 });
    const fix =
      recent ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
      ]));
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}
