// Hermes has no global crypto.randomUUID (browser API). Every id-generation
// call site in apps/mobile imports this instead — same source as the
// StoreEnvironment's randomUUID (see lib/legend/environment.ts).
import * as Crypto from 'expo-crypto';

export function randomUUID(): string {
  return Crypto.randomUUID();
}
