'use client';

// The device side of the helpers whose briefs only show facts and rows that
// act on their own (Money, Week, Dinners, Gifts): each opens its stores only
// while its helper's chat is open (a null group opens nothing), and builds
// the same brief the server puts in the prompt. Their rows have no brief
// action of their own: a cost or to-do row is the module's real row, and a
// night or an occasion opens its screen.

import { useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { useReconnectSync } from './data/create-group-store';
import { costItems$ } from './data/stores/cost-items-store';
import { householdTasks$ } from './data/stores/household-tasks-store';
import { mealPlanEntries$ } from './data/stores/meal-plan-store';
import { recipes$ } from './data/stores/recipes-store';
import { giftIdeas$, occasions$ } from './data/stores/occasions-stores';
import type { HelperBrief, HelperBriefState } from './module-helpers';
import type { CostItem, HouseholdTask, Recipe } from './types';
import type { MealPlanEntry } from './modules/meals/meal-plan';
import type { GiftIdea, Occasion } from './modules/occasions/occasions';
import { moneyBrief } from './modules/costs/helper-brief';
import { weekBrief } from './modules/household/helper-brief';
import { dinnersBrief } from './modules/meals/helper-brief';
import { giftsBrief } from './modules/occasions/helper-brief';

interface BriefInput {
  /** Set only while this helper's chat is open. */
  groupId: string | null | undefined;
  currentUserId: string | null | undefined;
  /** YYYY-MM-DD. */
  today: string;
}

const none = () => 0;
const noop = () => {};

/** A brief whose rows act through their own module rows: nothing for the brief itself to do. */
function factsOnly(brief: HelperBrief | null): HelperBriefState {
  return { brief, add: noop, act: noop, all: none, dismiss: noop };
}

function live<T extends { deleted?: boolean }>(record: Record<string, T | undefined> | null | undefined): T[] {
  return Object.values(record ?? {}).filter((r): r is T => !!r && !r.deleted);
}

export function useMoneyHelper({ groupId, today }: BriefInput): HelperBriefState {
  const items$ = costItems$(groupId ?? undefined);
  useReconnectSync(items$);
  const items = use$(() => live<CostItem>(items$.get()));
  const brief = useMemo(() => (groupId ? moneyBrief({ items, today }) : null), [groupId, items, today]);
  return factsOnly(brief);
}

export function useWeekHelper({ groupId, currentUserId, today }: BriefInput): HelperBriefState {
  const tasks$ = householdTasks$(groupId ?? undefined);
  useReconnectSync(tasks$);
  const tasks = use$(() => live<HouseholdTask>(tasks$.get()).filter((t) => !(t.private && t.assigned_to !== currentUserId)));
  const brief = useMemo(() => (groupId ? weekBrief({ tasks, today, me: currentUserId }) : null), [groupId, tasks, today, currentUserId]);
  return factsOnly(brief);
}

export function useDinnersHelper({ groupId, today }: BriefInput): HelperBriefState {
  const entries$ = mealPlanEntries$(groupId ?? undefined);
  const recs$ = recipes$(groupId ?? undefined);
  useReconnectSync(entries$);
  const entries = use$(() => live<MealPlanEntry>(entries$.get()));
  const recipes = use$(() => live<Recipe>(recs$.get()));
  const brief = useMemo(() => (groupId ? dinnersBrief({ entries, recipes, today }) : null), [groupId, entries, recipes, today]);
  return factsOnly(brief);
}

export function useGiftsHelper({ groupId, currentUserId, today }: BriefInput): HelperBriefState {
  const occ$ = occasions$(groupId ?? undefined);
  const ideas$ = giftIdeas$(groupId ?? undefined);
  useReconnectSync(occ$);
  useReconnectSync(ideas$);
  const kept = (r: { hidden_from?: string[] | null }) => !!currentUserId && (r.hidden_from ?? []).includes(currentUserId);
  const occasions = use$(() => live<Occasion>(occ$.get()).filter((o) => !kept(o)));
  const ideas = use$(() => live<GiftIdea>(ideas$.get()).filter((i) => !kept(i)));
  const brief = useMemo(() => (groupId ? giftsBrief({ occasions, ideas, today, me: currentUserId }) : null), [groupId, occasions, ideas, today, currentUserId]);
  return factsOnly(brief);
}
