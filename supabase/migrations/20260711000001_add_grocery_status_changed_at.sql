-- Add status_changed_at to grocery_items (FLUX-188 grocery improvement #2).
-- Records when an item's `status` (needed / bought / have) last changed, so the
-- card can show a relative "Bought · 2h ago" label. This is distinct from
-- `updated_at` (bumps on ANY edit — rename, price, qty) and `last_purchased_at`
-- (bought-only, date granularity). Nullable: legacy rows fall back to updated_at.
alter table grocery_items
  add column if not exists status_changed_at timestamptz;
