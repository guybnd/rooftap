import type { WebHere } from "@homeup/core";

// Where this browser is, for an Assistant "near me" ask. The browser asks
// the person the first time and remembers the answer; a no, a timeout or a
// browser without location resolves null, and the message goes without it.
export function devicePosition(): Promise<WebHere | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 }
    );
  });
}
