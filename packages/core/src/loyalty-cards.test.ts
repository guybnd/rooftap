import { describe, expect, it } from 'vitest';
import {
  cardCodePath,
  code128Values,
  ean13CheckDigit,
  encodeCode128,
  encodeEan13,
  encodeLoyaltyCard,
  encodeQr,
  formatLoyaltyNumber,
  loyaltyNumberError,
  loyaltyNumberTail,
  moduleRuns,
  normalizeLoyaltyNumber,
  sortLoyaltyCards,
} from './loyalty-cards';
import type { LoyaltyCard } from './types';

// The encoders were checked against an independent decoder (zxing) when they
// were written; these pin the outputs so a table edit can't drift silently.

describe('normalizeLoyaltyNumber', () => {
  it('strips the spaces and dashes printed on a numeric card', () => {
    expect(normalizeLoyaltyNumber(' 6008 9412-3456 7890 ', 'code128')).toBe('6008941234567890');
  });
  it('keeps letters and QR content as typed', () => {
    expect(normalizeLoyaltyNumber('AB 12', 'code128')).toBe('AB 12');
    expect(normalizeLoyaltyNumber(' https://x.y/a b ', 'qr')).toBe('https://x.y/a b');
  });
});

describe('loyaltyNumberError', () => {
  it('requires a number', () => {
    expect(loyaltyNumberError('', 'code128')).toBeTruthy();
  });
  it('checks EAN-13 length and check digit', () => {
    expect(loyaltyNumberError('400638133393', 'ean13')).toBeNull();
    expect(loyaltyNumberError('4006381333931', 'ean13')).toBeNull();
    expect(loyaltyNumberError('4006381333932', 'ean13')).toMatch(/last digit/);
    expect(loyaltyNumberError('12345', 'ean13')).toMatch(/12 or 13/);
  });
  it('rejects characters Code 128 set B cannot carry', () => {
    expect(loyaltyNumberError('café', 'code128')).toBeTruthy();
    expect(loyaltyNumberError('AB-12 xyz', 'code128')).toBeNull();
  });
});

describe('code128Values', () => {
  it('uses Code C for an even run of digits', () => {
    // start C (105), 42, checksum (105 + 42*1) % 103
    expect(code128Values('42')).toEqual([105, 42, 44]);
  });
  it('switches to Code B for an odd trailing digit', () => {
    const v = code128Values('123');
    expect(v.slice(0, 4)).toEqual([105, 12, 100, '3'.charCodeAt(0) - 32]);
  });
  it('uses Code B for text', () => {
    expect(code128Values('A')).toEqual([104, 33, (104 + 33) % 103]);
  });
});

describe('encodeCode128', () => {
  it('draws 11 modules per symbol plus a 13-module stop', () => {
    const modules = encodeCode128('6008941234567890');
    // start + 8 pairs + checksum = 10 symbols
    expect(modules.length).toBe(10 * 11 + 13);
    expect(modules[0]).toBe(true);
    expect(modules[modules.length - 1]).toBe(true);
  });
});

describe('EAN-13', () => {
  it('computes the check digit', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('930063312345')).toBe(1);
  });
  it('draws 95 modules with guard bars', () => {
    const bits = encodeEan13('4006381333931').map((b) => (b ? '1' : '0')).join('');
    expect(bits).toHaveLength(95);
    expect(bits.slice(0, 3)).toBe('101');
    expect(bits.slice(45, 50)).toBe('01010');
    expect(bits.slice(-3)).toBe('101');
  });
});

describe('encodeQr', () => {
  it('builds a square with finder patterns in three corners', () => {
    const m = encodeQr('6008941234567890');
    const n = m.length;
    expect(m.every((row) => row.length === n)).toBe(true);
    expect(m[0][0] && m[0][n - 1] && m[n - 1][0]).toBe(true);
    // the light separator around the top-left finder
    expect(m[7][0] || m[0][7] || m[7][7]).toBe(false);
  });
});

describe('encodeLoyaltyCard / cardCodePath', () => {
  it('returns null for an invalid number', () => {
    expect(encodeLoyaltyCard('123', 'ean13')).toBeNull();
  });
  it('includes the quiet zone in the path box', () => {
    const code = encodeLoyaltyCard('42', 'code128')!;
    const path = cardCodePath(code, 30);
    expect(path.width).toBe(3 * 11 + 13 + 20);
    expect(path.height).toBe(30);
    expect(path.d.startsWith('M10 0h2v30h-2z')).toBe(true);
  });
});

describe('helpers', () => {
  it('groups long numbers in fours', () => {
    expect(formatLoyaltyNumber('6008941234567890')).toBe('6008 9412 3456 7890');
    expect(formatLoyaltyNumber('AB12')).toBe('AB12');
  });
  it('shows the tail of a long number', () => {
    expect(loyaltyNumberTail('6008941234567890')).toBe('ending 7890');
    expect(loyaltyNumberTail('1234')).toBe('1234');
  });
  it('finds runs of bars', () => {
    expect(moduleRuns([true, true, false, true, false, false, true])).toEqual([[0, 2], [3, 1], [6, 1]]);
  });
  it('sorts by name, then number', () => {
    const card = (name: string, number: string) => ({ name, number }) as LoyaltyCard;
    const sorted = sortLoyaltyCards([card('flybuys', '2'), card('Everyday Rewards', '1'), card('Flybuys', '1')]);
    expect(sorted.map((c) => `${c.name} ${c.number}`)).toEqual(['Everyday Rewards 1', 'Flybuys 1', 'flybuys 2']);
  });
});
