-- FLUX-1560: Costs screen improvements — persisted "This month" filter default
-- and a dismissible "From your other sections" suggestion block.

alter table user_settings
  -- Whether the Costs list defaults to showing only this-month costs.
  -- Defaults true — the new focused view is the intended default experience.
  add column if not exists costs_this_month_only boolean not null default true,
  -- Whether the user has permanently dismissed the "From your other sections"
  -- suggestion block on the Costs screen. Defaults false (unseen until dismissed).
  add column if not exists costs_hide_section_suggestions boolean not null default false;
