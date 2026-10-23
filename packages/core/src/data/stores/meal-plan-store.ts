'use client';

// Meal plan: `meal_plan_entries` local-first store, so the week opens in the
// kitchen with no signal. Mirrors loyalty-cards-store.ts.

import { createGroupStore } from '../create-group-store';
import type { MealPlanEntry } from '../../modules/meals/meal-plan';

export const mealPlanEntries$ = createGroupStore<MealPlanEntry>({
  collection: 'meal_plan_entries',
  storageName: 'meal_plan_entries',
});
