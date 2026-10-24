-- Recipes "To try" list: ideas saved (often by the Assistant) that stay out of
-- the main book until someone keeps one. Additive with a false default, so
-- older app code reads every recipe as a normal one. The app gates the list
-- on `recipes.to-try` in server-features.ts.

alter table recipes add column if not exists to_try boolean not null default false;
