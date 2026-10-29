// crypto.randomUUID only exists in a secure context (https or localhost).
// A self-hosted server opened over plain http on a LAN address has
// crypto.getRandomValues but no randomUUID, so every new row (and Save in
// any sheet that makes one) threw. This fills randomUUID in from
// getRandomValues when the browser leaves it out. Imported first by
// lib/legend/environment.ts, which app/layout.tsx loads on every route.

/** A version 4 UUID from `getRandomValues`, the same shape as crypto.randomUUID. */
export function uuidFromRandomValues(getRandomValues: (bytes: Uint8Array) => Uint8Array): string {
  const b = getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Adds crypto.randomUUID where the runtime has getRandomValues but not randomUUID. */
export function ensureRandomUUID(target: { crypto?: Crypto } = globalThis): void {
  const c = target.crypto;
  if (!c || typeof c.randomUUID === 'function' || typeof c.getRandomValues !== 'function') return;
  const randomUUID = () => uuidFromRandomValues((bytes) => c.getRandomValues(bytes)) as `${string}-${string}-${string}-${string}-${string}`;
  try {
    Object.defineProperty(c, 'randomUUID', { value: randomUUID, configurable: true, writable: true });
  } catch {
    // A frozen crypto object: nothing to patch.
  }
}

ensureRandomUUID();
