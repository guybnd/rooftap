'use client';

// HOUP-434: Shopper's three synced tables. Offers and price snapshots are
// written by the server's source lookups (apps/web/src/app/api/shopper) and
// arrive here through sync; wants are written locally like any other row.

import { createGroupStore } from '../create-group-store';
import type { ShopperOffer, ShopperPriceSnapshot, ShopperWant } from '../../shopper';

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
