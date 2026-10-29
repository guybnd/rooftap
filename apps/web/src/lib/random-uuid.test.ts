import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ensureRandomUUID, uuidFromRandomValues } from './random-uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID outside a secure context', () => {
  it('makes version 4 UUIDs from getRandomValues', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidFromRandomValues((b) => webcrypto.getRandomValues(b))));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it('adds randomUUID when the browser leaves it out (plain http on a LAN address)', () => {
    const crypto = { getRandomValues: (b: Uint8Array) => webcrypto.getRandomValues(b) } as unknown as Crypto;
    ensureRandomUUID({ crypto });
    expect(crypto.randomUUID()).toMatch(V4);
  });

  it('keeps the browser randomUUID when it has one', () => {
    const own = () => '00000000-0000-4000-8000-000000000000' as const;
    const crypto = { getRandomValues: (b: Uint8Array) => b, randomUUID: own } as unknown as Crypto;
    ensureRandomUUID({ crypto });
    expect(crypto.randomUUID).toBe(own);
  });
});
