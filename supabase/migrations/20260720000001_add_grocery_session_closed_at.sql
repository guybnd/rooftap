-- Add closed_at to grocery_sessions (FLUX-1559 "Done shopping").
-- Stamped when a shop is finalized so the session-sync effect can freeze
-- summed_total_cents at its last live value instead of recomputing to 0 once
-- today's "Got it" items flip to "Have it" — which would otherwise delete the
-- day's grocery Costs line (syncCostLine deletes at amount <= 0).
alter table grocery_sessions
  add column if not exists closed_at timestamptz;
