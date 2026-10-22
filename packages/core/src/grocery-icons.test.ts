import { describe, expect, it } from 'vitest';
import { AISLE_EMOJI, GROCERY_ITEM_EMOJIS, getGroceryEmoji, greyscaleSvg, groceryGlyphSvg } from './grocery-icons';
import { AISLE_META } from './groceries';

describe('groceryGlyphSvg', () => {
  it('has a glyph for every emoji the matcher and aisles can return', () => {
    const emojis = new Set(GROCERY_ITEM_EMOJIS);
    for (const meta of Object.values(AISLE_META)) emojis.add(meta.icon);
    for (const e of Object.values(AISLE_EMOJI)) emojis.add(e);
    const missing = [...emojis].filter((e) => !groceryGlyphSvg(e));
    expect(missing).toEqual([]);
  });

  it('ignores the variation selector', () => {
    expect(groceryGlyphSvg('🏷️')).toBe(groceryGlyphSvg('🏷'));
  });

  it('returns svg markup for a matched item', () => {
    expect(groceryGlyphSvg(getGroceryEmoji('Granny Smith apples', 'produce'))).toMatch(/^<svg [^>]*viewBox="0 0 32 32"/);
  });

  it('is undefined for an unknown emoji', () => {
    expect(groceryGlyphSvg('🚀')).toBeUndefined();
  });
});

describe('greyscaleSvg', () => {
  it('turns every hex colour into its grey and leaves the rest alone', () => {
    expect(greyscaleSvg('<path fill="#ff0000" stroke="#FFF" d="M0 0"/>')).toBe('<path fill="#363636" stroke="#ffffff" d="M0 0"/>');
    const lemon = greyscaleSvg(groceryGlyphSvg(getGroceryEmoji('Lemons', 'produce'))!);
    for (const hex of lemon.match(/#[0-9a-f]{6}/gi) ?? []) expect(hex.slice(1, 3)).toBe(hex.slice(3, 5));
  });
});
