// Home's Spaces, by key (core slots/home-spaces.ts). Each module lists its
// Spaces in its manifest; this registry says how the phone draws each one.
// TypeScript fails until every Space has an entry here.
// Web twin: apps/web/src/app/home/home-spaces.tsx.
import * as React from 'react';
import type { Appointment, ApartmentWithScore, CostItem, Group, HomeSpaceKey } from '@homeup/core';
import { GroceriesWidget } from './groceries-widget';
import { BudgetSpace, BillsSpace } from './money-spaces';
import { AssistantTile, HomeSearchTile, SetupTile, ShopperTile } from './section-tiles';

/** What Home hands every Space. */
export interface HomeSpaceProps {
  group: Group;
  currentUserId: string | null;
  /** Filtered to its shortcut, it shows everything. */
  expanded: boolean;
  costItems: CostItem[];
  budgetCents: number | null;
  apartments: ApartmentWithScore[];
  appointments: Appointment[];
  now: Date;
}

export const HOME_SPACE_VIEWS: Record<HomeSpaceKey, (props: HomeSpaceProps) => React.ReactNode> = {
  groceries: (p) => <GroceriesWidget group={p.group} currentUserId={p.currentUserId} expanded={p.expanded} />,
  budget: (p) => (
    <BudgetSpace group={p.group} currentUserId={p.currentUserId} costItems={p.costItems} budgetCents={p.budgetCents} expanded={p.expanded} now={p.now} />
  ),
  bills: (p) => <BillsSpace costItems={p.costItems} expanded={p.expanded} now={p.now} />,
  setup: (p) => <SetupTile group={p.group} />,
  // The phone shows Home Search once there is a listing.
  search: (p) => (p.apartments.length > 0 ? <HomeSearchTile apartments={p.apartments} appointments={p.appointments} /> : null),
  shopper: (p) => <ShopperTile group={p.group} expanded={p.expanded} />,
  assistant: () => <AssistantTile />,
};
