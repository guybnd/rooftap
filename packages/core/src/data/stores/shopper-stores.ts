'use client';

// HOUP-434: Shopper's three synced tables. Offers and price snapshots are
// written by the server's source lookups (apps/web/src/app/api/shopper) and
// arrive here through sync; wants are written locally like any other row.

import { createGroupStore } from '../create-group-store';
import type { ShopperOffer, ShopperPriceSnapshot, ShopperWant } from '../../modules/shopper/shopper';
import type { ShopperPick, ShopperSearch } from '../../modules/shopper/shopper-scout';

export const shopperWants$ = createGroupStore<ShopperWant>({
  collection: 'shopper_wants',
  storageName: 'shopper_wants',
});

export const shopperOffers$ = createGroupStore<ShopperOffer>({
  collection: 'shopper_offers',
  storageName: 'shopper_offers',
});

export const shopperPriceSnapshots$ = createGroupStore<ShopperPriceSnapshot>({
  collection: 'shopper_price_snapshots',
  storageName: 'shopper_price_snapshots',
});

// HOUP-435: Scout runs and their picks, written by the server.
export const shopperSearches$ = createGroupStore<ShopperSearch>({
  collection: 'shopper_searches',
  storageName: 'shopper_searches',
});

export const shopperPicks$ = createGroupStore<ShopperPick>({
  collection: 'shopper_picks',
  storageName: 'shopper_picks',
});
