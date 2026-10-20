-- FLUX-1577: Backfill start_date for legacy one-off cost actuals.
--
-- One-off actuals logged before the FLUX-1575/1576 date-stamping fixes have
-- start_date IS NULL. They still count in the date-agnostic "One-off total"
-- tile (totalOneOff, src/lib/costs.ts) but are excluded from every month
-- bucket by design (monthlyProjection, src/lib/costs.ts:234 — FLUX-1575),
-- so historical month totals undercount by the sum of these undated rows.
--
-- Recovery: date each affected row from created_at (the only date signal
-- available), cast in Australia/Sydney (region is AU-first) so a late-evening
-- AU purchase doesn't land on the wrong day via a bare UTC ::date cast.
--
-- Idempotent: only touches rows that still have start_date IS NULL, so a
-- re-run is a no-op. The handle_times() trigger (20260618000001/000002)
-- bumps updated_at on this UPDATE, so backfilled rows propagate to every
-- client via the existing changesSince sync — no client migration needed.
update cost_items
set start_date = (created_at at time zone 'Australia/Sydney')::date
where cadence = 'one_off'
  and is_estimate = false
  and start_date is null
  and amount > 0
  and deleted = false;
