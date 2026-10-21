'use client';

// Rewards module: schemes, their partner stores and perks. Cards stay in
// loyaltyCards$ (shared with Groceries). Local-first like every group store,
// so the store lookup works in a shop with no signal.

import { createGroupStore } from '../create-group-store';
import type { RewardPartner, RewardPerk, RewardScheme } from '../../rewards';

export const rewardSchemes$ = createGroupStore<RewardScheme>({
  collection: 'reward_schemes',
  storageName: 'reward_schemes',
});

export const rewardPartners$ = createGroupStore<RewardPartner>({
  collection: 'reward_partners',
  storageName: 'reward_partners',
});

export const rewardPerks$ = createGroupStore<RewardPerk>({
  collection: 'reward_perks',
  storageName: 'reward_perks',
});
