-- Meal plan: several dishes on one night (Recipes v2, R6). A night can now
-- hold a main plus sides and a dessert, one meal_plan_entries row per dish,
-- instead of one row where the newest wins
-- (packages/core/src/modules/meals/meal-plan.ts, mealDishesByDate).
--
-- position orders dishes inside a role; role says what the dish is on the
-- night (null reads as a main for rows written before this migration).
--
-- Additive and safe ahead of code: two new columns with defaults that the
-- old app never reads or writes. Apps gate the "Add a dish" surface on this
-- migration (server-features.ts, meals.multi-dish), so they never write the
-- new columns to a server without them. The table is already granted
-- (20261023130000_meal_plan.sql).

alter table meal_plan_entries add column if not exists position integer not null default 0;
alter table meal_plan_entries add column if not exists role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meal_plan_entries_role_check'
  ) then
    alter table meal_plan_entries
      add constraint meal_plan_entries_role_check check (role is null or role in ('main', 'side', 'dessert'));
  end if;
end $$;
