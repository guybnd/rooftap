-- FLUX-164: add completion timestamp to household_tasks
-- Nullable, no default — existing done rows get NULL and are intentionally hidden
-- (legacy done && completed_at IS NULL behaviour unchanged). Set when done→true,
-- cleared when un-checked.

alter table household_tasks
  add column completed_at timestamptz;
