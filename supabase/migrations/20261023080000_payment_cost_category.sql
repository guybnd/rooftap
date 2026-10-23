-- Costs: move one bank payment to a category of its own.
--
-- Until now a payment took its category from the cost line it is filed
-- under, else from its shop's line, else from the bank's own category. A
-- person can now pick a category for one payment alone (say one Bunnings
-- trip that was a birthday present). It wins over the line's category and
-- never teaches the shop's other payments.
--
-- Additive and safe ahead of code: one nullable column. Code that predates
-- it never reads it, and the apps only offer the choice on servers that
-- have it ('costs.quick-move' in packages/core/src/server-features.ts).

alter table public.bank_transactions
  add column if not exists cost_category text;
