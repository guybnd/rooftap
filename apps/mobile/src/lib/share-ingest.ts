// HOUP-148: hand-off scratch space between <ShareIntentHandler/> (mounted at
// the app root) and the screen that consumes a drained Android share intent.
// expo-router params are string-only, and both a shared screenshot (read as a
// base64 data-URL) and a shared .ics file's raw text can be arbitrarily
// large, so — same reasoning as any oversized payload — they're staged here
// as module-level state instead of URL-encoded into the destination route.
// "Take" clears the slot so a screen re-mount (e.g. back-navigation) doesn't
// replay stale shared content.
let pendingImageUris: string[] | null = null;
let pendingIcsText: string | null = null;

export function setPendingShareImages(uris: string[]): void {
  pendingImageUris = uris;
}

export function takePendingShareImages(): string[] | null {
  const uris = pendingImageUris;
  pendingImageUris = null;
  return uris;
}

export function setPendingShareIcs(text: string): void {
  pendingIcsText = text;
}

export function takePendingShareIcs(): string | null {
  const text = pendingIcsText;
  pendingIcsText = null;
  return text;
}
