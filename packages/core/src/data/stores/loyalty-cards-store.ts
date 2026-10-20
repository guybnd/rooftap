'use client';

// Rewards cards in Groceries: `loyalty_cards` local-first store, so a card
// opens at the checkout with no signal. Mirrors events-store.ts.

import { createGroupStore } from '../create-group-store';
import type { LoyaltyCard } from '../../types';

export const loyaltyCards$ = createGroupStore<LoyaltyCard>({
  collection: 'loyalty_cards',
  storageName: 'loyalty_cards',
});
