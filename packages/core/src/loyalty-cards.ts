// Rewards cards (Groceries): validation, display helpers and the barcode/QR
// encoders both apps draw from. The encoders return plain module data (bars
// for 1D codes, a dark/light grid for QR) so web renders it as DOM <svg> and
// native as react-native-svg, with no native barcode library (OTA-safe).

import qrcode from 'qrcode-generator';
import type { LoyaltyCard, LoyaltyCardFormat } from './types';

export const LOYALTY_CARD_FORMATS: { value: LoyaltyCardFormat; label: string }[] = [
  { value: 'code128', label: 'Barcode' },
  { value: 'ean13', label: 'EAN-13' },
  { value: 'qr', label: 'QR code' },
];

export function loyaltyFormatLabel(format: LoyaltyCardFormat): string {
  return LOYALTY_CARD_FORMATS.find((f) => f.value === format)?.label ?? 'Barcode';
}

const MAX_CODE128_LENGTH = 48;
const MAX_QR_LENGTH = 500;

/**
 * What the code should encode. Printed card numbers carry spaces or dashes
 * ("6008 9412 3456 7890"); a 1D code encodes the bare digits. QR content is
 * kept verbatim apart from trimming, since it may be a URL or token.
 */
export function normalizeLoyaltyNumber(raw: string, format: LoyaltyCardFormat): string {
  const trimmed = raw.trim();
  if (format === 'qr') return trimmed;
  if (/^[\d\s-]+$/.test(trimmed)) return trimmed.replace(/[\s-]/g, '');
  return trimmed;
}

/** Why `number` can't be drawn in `format`, or null when it can. Expects a normalized number. */
export function loyaltyNumberError(number: string, format: LoyaltyCardFormat): string | null {
  if (!number) return 'Enter the card number';
  if (format === 'ean13') {
    if (!/^\d{12,13}$/.test(number)) return 'EAN-13 needs 12 or 13 digits';
    if (number.length === 13 && ean13CheckDigit(number.slice(0, 12)) !== Number(number[12])) {
      return "The last digit doesn't match. Check the number";
    }
    return null;
  }
  if (format === 'code128') {
    if (number.length > MAX_CODE128_LENGTH) return `Barcodes hold up to ${MAX_CODE128_LENGTH} characters`;
    if (!/^[\x20-\x7e]+$/.test(number)) return 'Use letters, digits and basic symbols only';
    return null;
  }
  if (number.length > MAX_QR_LENGTH) return `QR codes here hold up to ${MAX_QR_LENGTH} characters`;
  return null;
}

/** Digits grouped in fours for reading aloud at the till; anything else as is. */
export function formatLoyaltyNumber(number: string): string {
  if (!/^\d{8,}$/.test(number)) return number;
  return number.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** The row's short fragment: the last four characters of a long number. */
export function loyaltyNumberTail(number: string): string {
  return number.length > 6 ? `ending ${number.slice(-4)}` : number;
}

/** Cards in display order: by name, then by number for two cards of one scheme. */
export function sortLoyaltyCards(cards: LoyaltyCard[]): LoyaltyCard[] {
  return [...cards].sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.number.localeCompare(b.number),
  );
}

// ── Encoders ─────────────────────────────────────────────────────────────────

export type EncodedCardCode =
  /** A 1D code: one entry per module, true = bar. No quiet zone. */
  | { kind: 'linear'; modules: boolean[]; quietZone: number }
  /** A 2D code: rows of modules, true = dark. No quiet zone. */
  | { kind: 'matrix'; modules: boolean[][]; quietZone: number };

/** Encode a card for drawing, or null when the number isn't valid for its format. */
export function encodeLoyaltyCard(number: string, format: LoyaltyCardFormat): EncodedCardCode | null {
  if (loyaltyNumberError(number, format)) return null;
  if (format === 'qr') return { kind: 'matrix', modules: encodeQr(number), quietZone: 4 };
  if (format === 'ean13') return { kind: 'linear', modules: encodeEan13(number), quietZone: 11 };
  return { kind: 'linear', modules: encodeCode128(number), quietZone: 10 };
}

/** Runs of consecutive true modules as [start, length] pairs: one rect per bar. */
export function moduleRuns(modules: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  modules.forEach((on, i) => {
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      runs.push([start, i - start]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, modules.length - start]);
  return runs;
}

/**
 * One SVG path `d` for a code, in module units with the quiet zone included,
 * so a renderer only needs a viewBox and a fill. 1D codes are drawn
 * `height` modules tall.
 */
export function cardCodePath(code: EncodedCardCode, height = 1): { d: string; width: number; height: number } {
  const q = code.quietZone;
  if (code.kind === 'linear') {
    const d = moduleRuns(code.modules)
      .map(([x, w]) => `M${x + q} 0h${w}v${height}h${-w}z`)
      .join('');
    return { d, width: code.modules.length + q * 2, height };
  }
  const size = code.modules.length;
  const d = code.modules
    .flatMap((row, y) => moduleRuns(row).map(([x, w]) => `M${x + q} ${y + q}h${w}v1h${-w}z`))
    .join('');
  return { d, width: size + q * 2, height: size + q * 2 };
}

// Code 128 symbol widths (bar, space, bar, space, bar, space), values 0-105;
// 106 is the stop symbol with its trailing bar.
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_CODE_B = 100;
const CODE128_STOP = 106;

/**
 * Code 128 symbol values for `text` (start and checksum included, stop
 * excluded). All-digit numbers use Code C (two digits per symbol), switching to
 * Code B for an odd trailing digit; anything else is Code B.
 */
export function code128Values(text: string): number[] {
  const values: number[] = [];
  if (/^\d+$/.test(text) && text.length >= 2) {
    values.push(CODE128_START_C);
    const pairs = Math.floor(text.length / 2);
    for (let i = 0; i < pairs; i++) values.push(Number(text.slice(i * 2, i * 2 + 2)));
    if (text.length % 2 === 1) {
      values.push(CODE128_CODE_B, text.charCodeAt(text.length - 1) - 32);
    }
  } else {
    values.push(CODE128_START_B);
    for (const ch of text) values.push(ch.charCodeAt(0) - 32);
  }
  const checksum = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(checksum);
  return values;
}

function widthsToModules(widths: string, modules: boolean[]): void {
  for (let i = 0; i < widths.length; i++) {
    const bar = i % 2 === 0;
    for (let n = 0; n < Number(widths[i]); n++) modules.push(bar);
  }
}

export function encodeCode128(text: string): boolean[] {
  const modules: boolean[] = [];
  for (const v of [...code128Values(text), CODE128_STOP]) widthsToModules(CODE128_PATTERNS[v], modules);
  return modules;
}

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''));
// Which left-half digits use the G set, by the (implied) first digit.
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(first12: string): number {
  const sum = [...first12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/** EAN-13 modules for 12 digits (check digit appended) or 13 (assumed valid). */
export function encodeEan13(digits: string): boolean[] {
  const full = digits.length === 12 ? digits + ean13CheckDigit(digits) : digits;
  const parity = EAN_PARITY[Number(full[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'G' ? EAN_G : EAN_L)[Number(full[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(full[i])];
  bits += '101';
  return [...bits].map((b) => b === '1');
}

/** QR modules (error correction M, smallest version that fits). */
export function encodeQr(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}
