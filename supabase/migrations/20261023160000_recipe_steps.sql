-- Recipes v2: structured steps with timers.
--
-- `steps` holds the method as an ordered list of steps (text, original
-- wording, timers, the ingredients each step uses, an optional temperature;
-- packages/core/src/modules/recipes/steps.ts). `instructions` stays the
-- plain-text copy that every write keeps in step, so older apps still read
-- and edit the method.
--
-- Additive and safe ahead of code: a new nullable column on an existing
-- table, which nothing writes until the app knows the server has it
-- (`recipes.steps` in server-features.ts).

alter table recipes add column if not exists steps jsonb;
