import { describe, expect, it } from 'vitest';
import { offerMismatch, relevantOffers } from './shopper-relevance';

const offer = (title: string, dollars: number) => ({ title, price_cents: dollars * 100 });

describe('offerMismatch', () => {
  it('keeps the product, with the model inside a longer model number', () => {
    expect(offerMismatch('LG C5', 'LG OLED65C5PSA 65 inch OLED evo C5 4K Smart TV')).toBeNull();
    expect(offerMismatch('LG C5', 'LG 55" C5 OLED TV')).toBeNull();
  });

  it('drops accessories and parts', () => {
    expect(offerMismatch('LG C5', 'Power Cable for LG C5 OLED TV')).toBe('accessory');
    expect(offerMismatch('LG C5', 'Remote control replacement LG C5')).toBe('accessory');
    expect(offerMismatch('LG C5', 'Wall mount suits LG C5 55"')).toBe('accessory');
  });

  it('drops other products from the brand', () => {
    expect(offerMismatch('LG C5', 'LG 335L Bottom Mount Fridge GB-335PL')).toBe('missing-model');
    expect(offerMismatch('Sony Bravia 65', 'Samsung 65 inch QLED')).toBe('missing-words');
  });

  it('keeps an accessory the search asks for', () => {
    expect(offerMismatch('LG C5 wall mount', 'LG C5 wall mount bracket')).toBeNull();
  });
});

describe('relevantOffers', () => {
  it('turns the LG C5 search into TVs only', () => {
    const kept = relevantOffers('LG C5', [
      offer('Power cable for LG C5', 13),
      offer('LG C5 replacement remote', 18),
      offer('LG GB-335PL fridge', 819),
      offer('LG OLED55C5PSA 55" C5 OLED', 2199),
      offer('LG OLED65C5PSA 65" C5 OLED', 2999),
      offer('LG C5 OLED 65 inch', 2895),
    ]);
    expect(kept.map((o) => o.price_cents / 100)).toEqual([2199, 2999, 2895]);
  });

  it('drops a price far under the rest or under the household target', () => {
    const offers = [offer('LG C5 OLED 65', 40), offer('LG C5 OLED 65', 2500), offer('LG C5 OLED 65', 2600), offer('LG C5 OLED 65', 2700)];
    expect(relevantOffers('LG C5', offers)).toHaveLength(3);
    expect(relevantOffers('LG C5', offers.slice(0, 2), { referenceCents: 250000 })).toHaveLength(1);
  });
});
