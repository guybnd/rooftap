'use client';

// Rewards module: the household's schemes, partner stores, perks and cards,
// with the writes both apps' Rewards screens make. Cards are loyalty_cards
// rows, the same ones Groceries' rewards sheet shows.

import { useCallback, useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import type { LoyaltyCard } from '../../types';
import { loyaltyCards$, rewardPartners$, rewardPerks$, rewardSchemes$ } from '../../data/stores';
import { useReconnectSync, useStoreHelpers } from '../../data/create-group-store';
import { useStoreLoaded } from '../../data/use-store-loaded';
import { envRandomUUID } from '../../data/store-environment';
import {
  buildRewardPartner,
  buildRewardScheme,
  newPartnerNames,
  type RewardCatalogEntry,
  type RewardPerk,
  type RewardScheme,
  type RewardSchemeKind,
} from './rewards';

function live<T extends { deleted: boolean }>(record: Record<string, T | undefined> | undefined): T[] {
  return Object.values(record ?? {}).filter((r): r is T => !!r && !r.deleted);
}

export function useRewards(groupId: string | undefined, currentUserId: string | null | undefined) {
  const schemes$ = rewardSchemes$(groupId);
  const partners$ = rewardPartners$(groupId);
  const perks$ = rewardPerks$(groupId);
  const cards$ = loyaltyCards$(groupId);
  useReconnectSync(schemes$);
  useReconnectSync(partners$);
  useReconnectSync(perks$);
  useReconnectSync(cards$);
  const loaded = useStoreLoaded(schemes$, partners$, perks$, cards$);

  const schemes = use$(() => live(schemes$.get()));
  const partners = use$(() => live(partners$.get()));
  const perks = use$(() => live(perks$.get()));
  const cards = use$(() => live(cards$.get()));

  const schemeHelpers = useStoreHelpers(schemes$, currentUserId);
  const partnerHelpers = useStoreHelpers(partners$, currentUserId);
  const perkHelpers = useStoreHelpers(perks$, currentUserId);
  const cardHelpers = useStoreHelpers(cards$, currentUserId);

  const addPartners = useCallback(
    (schemeId: string, names: string[], category: string | null = null) => {
      if (!groupId) return;
      const existing = partners.filter((p) => p.scheme_id === schemeId);
      for (const name of newPartnerNames(names, existing)) {
        partnerHelpers.writeRow(buildRewardPartner({ id: envRandomUUID(), groupId, schemeId, name, category }));
      }
    },
    [groupId, partners, partnerHelpers],
  );

  /** Create a scheme, with its stores when it comes from the starter list. Returns its id. */
  const addScheme = useCallback(
    (input: { name: string; kind?: RewardSchemeKind; catalog?: RewardCatalogEntry }): string | null => {
      if (!groupId) return null;
      const { catalog } = input;
      const scheme = buildRewardScheme({
        id: envRandomUUID(),
        groupId,
        name: catalog?.name ?? input.name,
        kind: catalog?.kind ?? input.kind,
        website: catalog?.website ?? null,
        color: catalog?.color ?? null,
        catalogId: catalog?.id ?? null,
      });
      schemeHelpers.writeRow(scheme);
      for (const p of catalog?.partners ?? []) {
        partnerHelpers.writeRow(
          buildRewardPartner({ id: envRandomUUID(), groupId, schemeId: scheme.id, name: p.name, category: p.category ?? null }),
        );
      }
      return scheme.id;
    },
    [groupId, schemeHelpers, partnerHelpers],
  );

  const saveScheme = useCallback((scheme: RewardScheme) => schemeHelpers.writeRow(scheme), [schemeHelpers]);

  /** Remove a scheme with its stores and perks. Its cards stay, as plain cards. */
  const deleteScheme = useCallback(
    (schemeId: string) => {
      for (const p of perks) if (p.scheme_id === schemeId) perkHelpers.softDeleteRow(p.id);
      for (const p of partners) if (p.scheme_id === schemeId) partnerHelpers.softDeleteRow(p.id);
      for (const c of cards) if (c.scheme_id === schemeId) cardHelpers.patchRow(c.id, { scheme_id: null });
      schemeHelpers.softDeleteRow(schemeId);
    },
    [perks, partners, cards, perkHelpers, partnerHelpers, cardHelpers, schemeHelpers],
  );

  /** Remove a store, and the perks that only applied there. */
  const removePartner = useCallback(
    (partnerId: string) => {
      for (const p of perks) if (p.partner_id === partnerId) perkHelpers.softDeleteRow(p.id);
      partnerHelpers.softDeleteRow(partnerId);
    },
    [perks, perkHelpers, partnerHelpers],
  );

  const savePerk = useCallback((perk: RewardPerk) => perkHelpers.writeRow(perk), [perkHelpers]);
  const removePerk = useCallback((perkId: string) => perkHelpers.softDeleteRow(perkId), [perkHelpers]);

  const saveCard = useCallback((card: LoyaltyCard) => cardHelpers.writeRow(card), [cardHelpers]);
  const deleteCard = useCallback((cardId: string) => cardHelpers.softDeleteRow(cardId), [cardHelpers]);

  const schemeById = useMemo(() => new Map(schemes.map((s) => [s.id, s])), [schemes]);
  const schemeOf = useCallback(
    (card: LoyaltyCard | null | undefined): RewardScheme | null => (card?.scheme_id ? schemeById.get(card.scheme_id) ?? null : null),
    [schemeById],
  );

  return {
    loaded,
    schemes,
    partners,
    perks,
    cards,
    schemeOf,
    addScheme,
    saveScheme,
    deleteScheme,
    addPartners,
    removePartner,
    savePerk,
    removePerk,
    saveCard,
    deleteCard,
  };
}

export type RewardsApi = ReturnType<typeof useRewards>;
