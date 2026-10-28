'use client';

// Rewards' slots (.docs/modules.md, section 17). Search: every scheme, by
// name, with its partner stores and perks as keywords, so "Bunnings" finds
// the scheme that works there.

import { useMemo } from 'react';
import { rewardPartners$, rewardPerks$, rewardSchemes$ } from '../../data/stores';
import type { GlobalHit } from '../../hooks/use-global-search-index';
import { useSlotRows } from '../../slots/rows';
import type { SearchSource } from '../../slots/types';
import { REWARD_SCHEME_KINDS, type RewardPartner, type RewardPerk, type RewardScheme } from './rewards';

export function rewardsSearchHits(
  schemes: readonly RewardScheme[],
  partners: readonly RewardPartner[],
  perks: readonly RewardPerk[],
): GlobalHit[] {
  return schemes
    .filter((s) => !s.deleted)
    .map((s) => ({
      section: 'rewards',
      sectionId: 'rewards',
      sectionLabel: 'Rewards',
      id: s.id,
      title: s.name,
      subtitle: REWARD_SCHEME_KINDS.find((k) => k.value === s.kind)?.label,
      keywords: [
        ...partners.filter((p) => !p.deleted && p.scheme_id === s.id).map((p) => p.name),
        ...perks.filter((p) => !p.deleted && p.scheme_id === s.id).map((p) => p.title),
        s.notes,
      ]
        .filter(Boolean)
        .join(' '),
      href: '/rewards',
    }));
}

export const rewardsSearchSource: SearchSource = {
  moduleId: 'rewards',
  useHits({ groupId, active }) {
    const schemes = useSlotRows(rewardSchemes$, groupId, active);
    const partners = useSlotRows(rewardPartners$, groupId, active);
    const perks = useSlotRows(rewardPerks$, groupId, active);
    return useMemo(() => ({ hits: rewardsSearchHits(schemes, partners, perks) }), [schemes, partners, perks]);
  },
};
