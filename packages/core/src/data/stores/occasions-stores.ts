'use client';

// Occasions module: the household's occasions, gift ideas and wishlists.
// The database leaves out rows kept from the signed-in person, so these
// stores never hold someone's surprise on their own device.

import { createGroupStore } from '../create-group-store';
import type { GiftIdea, Occasion, WishlistItem } from '../../modules/occasions/occasions';

export const occasions$ = createGroupStore<Occasion>({
  collection: 'occasions',
  storageName: 'occasions',
});

export const giftIdeas$ = createGroupStore<GiftIdea>({
  collection: 'gift_ideas',
  storageName: 'gift_ideas',
});

export const wishlistItems$ = createGroupStore<WishlistItem>({
  collection: 'wishlist_items',
  storageName: 'wishlist_items',
});
