// Compile-time check that the row types the synced stores use (types.ts and
// friends) still match the database (database.types.ts, generated from
// supabase/migrations by `npm run db:types`). Nothing imports this file; the
// package typecheck compiles it, so a mismatch fails CI.
//
// For each store it asserts:
// - every field of the app type is a column of its table, so a renamed or
//   missing column fails here and not as a dropped write on a phone (the
//   synced store sends the whole row, and the server rejects unknown columns);
// - no field has a different base type than its column (JSON columns aside,
//   which the app types more precisely);
// - the columns that can hold null while the app type says they never do are
//   exactly the known ones listed below. Render code must guard those. A new
//   one fails here: make the app type nullable, or the column not null.

import type { Database, Json } from './database.types';
import type * as App from './index';

type Tables = Database['public']['Tables'];
type Row<N extends keyof Tables> = Tables[N]['Row'];
type Shared<H, R> = keyof H & keyof R;

/** App fields with no column in the table. */
type MissingColumns<H, R> = Exclude<keyof H, keyof R>;
/** Fields whose base type differs from the column's, JSON columns aside. */
type WrongTypes<H, R> = { [K in Shared<H, R>]: Json extends R[K] ? never : NonNullable<H[K]> extends NonNullable<R[K]> ? never : K }[Shared<H, R>];
/** Columns that can be null while the app type says they never are (JSON columns aside: their type always allows null). */
type HiddenNulls<H, R> = { [K in Shared<H, R>]: Json extends R[K] ? never : null extends R[K] ? (null extends H[K] ? never : K) : never }[Shared<H, R>];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/**
 * One store's row type against its table: [no missing columns, no wrong
 * types, hidden nulls are exactly `KnownNulls`]. On a failure the error
 * shows which of the three is false.
 */
type Matches<H, N extends keyof Tables, KnownNulls = never> = [
  Equal<MissingColumns<H, Row<N>>, never>,
  Equal<WrongTypes<H, Row<N>>, never>,
  Equal<HiddenNulls<H, Row<N>>, KnownNulls>,
];
type Ok = [true, true, true];

export type AgentsMatches = Expect<Equal<Matches<App.Agent, 'agents', 'created_at' | 'updated_at'>, Ok>>;
export type ApartmentAgentsMatches = Expect<Equal<Matches<App.ApartmentAgent, 'apartment_agents', 'created_at'>, Ok>>;
export type ApartmentCommentsMatches = Expect<Equal<Matches<App.ApartmentComment, 'apartment_comments'>, Ok>>;
export type ApartmentsMatches = Expect<Equal<Matches<App.Apartment, 'apartments'>, Ok>>;
export type AppointmentsMatches = Expect<Equal<Matches<App.Appointment, 'appointments'>, Ok>>;
export type BinChangesMatches = Expect<Equal<Matches<App.BinChange, 'bin_changes'>, Ok>>;
export type BinPlansMatches = Expect<Equal<Matches<App.BinPlan, 'bin_plans'>, Ok>>;
export type BinStreamsMatches = Expect<Equal<Matches<App.BinStream, 'bin_streams'>, Ok>>;
export type ChecklistItemsMatches = Expect<Equal<Matches<App.ChecklistItem, 'checklist_items'>, Ok>>;
export type ChecklistResponsesMatches = Expect<Equal<Matches<App.ChecklistResponse, 'checklist_responses'>, Ok>>;
export type ChecklistTaskItemsMatches = Expect<Equal<Matches<App.ChecklistTaskItem, 'checklist_task_items'>, Ok>>;
export type ChecklistTemplateItemsMatches = Expect<Equal<Matches<App.ChecklistTemplateItem, 'checklist_template_items'>, Ok>>;
export type ChecklistTemplatesMatches = Expect<Equal<Matches<App.ChecklistTemplate, 'checklist_templates'>, Ok>>;
export type ChecklistsMatches = Expect<Equal<Matches<App.Checklist, 'checklists'>, Ok>>;
export type CostItemsMatches = Expect<Equal<Matches<App.CostItem, 'cost_items'>, Ok>>;
export type DocumentsMatches = Expect<Equal<Matches<App.Document, 'documents'>, Ok>>;
export type EventsMatches = Expect<Equal<Matches<App.GroupEvent, 'events'>, Ok>>;
export type GroceryItemsMatches = Expect<Equal<Matches<App.GroceryItem, 'grocery_items'>, Ok>>;
export type HouseholdTasksMatches = Expect<Equal<Matches<App.HouseholdTask, 'household_tasks'>, Ok>>;
export type LoyaltyCardsMatches = Expect<Equal<Matches<App.LoyaltyCard, 'loyalty_cards'>, Ok>>;
export type MealPlanEntriesMatches = Expect<Equal<Matches<App.MealPlanEntry, 'meal_plan_entries'>, Ok>>;
export type RecipeIngredientsMatches = Expect<Equal<Matches<App.RecipeIngredient, 'recipe_ingredients'>, Ok>>;
export type RecipesMatches = Expect<Equal<Matches<App.Recipe, 'recipes'>, Ok>>;
export type RewardPartnersMatches = Expect<Equal<Matches<App.RewardPartner, 'reward_partners'>, Ok>>;
export type RewardPerksMatches = Expect<Equal<Matches<App.RewardPerk, 'reward_perks'>, Ok>>;
export type RewardSchemesMatches = Expect<Equal<Matches<App.RewardScheme, 'reward_schemes'>, Ok>>;
export type OccasionsMatches = Expect<Equal<Matches<App.Occasion, 'occasions'>, Ok>>;
export type GiftIdeasMatches = Expect<Equal<Matches<App.GiftIdea, 'gift_ideas'>, Ok>>;
export type WishlistItemsMatches = Expect<Equal<Matches<App.WishlistItem, 'wishlist_items'>, Ok>>;
export type SavedSearchesMatches = Expect<Equal<Matches<App.SavedSearch, 'saved_searches'>, Ok>>;
export type SetupItemsMatches = Expect<Equal<Matches<App.SetupItem, 'setup_items', 'room' | 'sort_order'>, Ok>>;
export type ShopperOffersMatches = Expect<Equal<Matches<App.ShopperOffer, 'shopper_offers'>, Ok>>;
export type ShopperPicksMatches = Expect<Equal<Matches<App.ShopperPick, 'shopper_picks'>, Ok>>;
export type ShopperPriceSnapshotsMatches = Expect<Equal<Matches<App.ShopperPriceSnapshot, 'shopper_price_snapshots'>, Ok>>;
export type ShopperSearchesMatches = Expect<Equal<Matches<App.ShopperSearch, 'shopper_searches'>, Ok>>;
export type ShopperWantsMatches = Expect<Equal<Matches<App.ShopperWant, 'shopper_wants'>, Ok>>;
