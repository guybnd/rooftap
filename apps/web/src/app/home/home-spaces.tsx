// Home's Spaces, by key (core slots/home-spaces.ts). Each module lists its
// Spaces in its manifest; this registry says how the web app draws each one.
// TypeScript fails until every Space has an entry here.
// Native twin: apps/mobile/src/features/home/home-spaces.tsx.
import type { ReactNode } from "react";
import type { Appointment, ApartmentWithScore, CostItem, Group, HomeSpaceKey } from "@homeup/core";
import { GroceriesWidget } from "./groceries-widget";
import { BudgetSpace, BillsSpace } from "./money-spaces";
import { AssistantTile, HomeSearchTile, SetupTile, ShopperTile } from "./section-tiles";

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

export interface HomeSpaceView {
  render: (props: HomeSpaceProps) => ReactNode;
  /** On the desktop grid it shows expanded: the desk has room for the whole list. */
  deskExpanded?: boolean;
}

export const HOME_SPACE_VIEWS: Record<HomeSpaceKey, HomeSpaceView> = {
  groceries: {
    render: (p) => <GroceriesWidget group={p.group} currentUserId={p.currentUserId} expanded={p.expanded} />,
    deskExpanded: true,
  },
  budget: {
    render: (p) => (
      <BudgetSpace group={p.group} currentUserId={p.currentUserId} costItems={p.costItems} budgetCents={p.budgetCents} expanded={p.expanded} now={p.now} />
    ),
  },
  bills: { render: (p) => <BillsSpace costItems={p.costItems} expanded={p.expanded} now={p.now} /> },
  setup: { render: (p) => <SetupTile group={p.group} /> },
  search: { render: (p) => <HomeSearchTile apartments={p.apartments} appointments={p.appointments} /> },
  shopper: { render: (p) => <ShopperTile group={p.group} expanded={p.expanded} /> },
  assistant: { render: () => <AssistantTile /> },
};
