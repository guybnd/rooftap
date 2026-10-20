-- FLUX-133: per-category sub-fields live on the document (docs-centric pivot).
-- A flexible JSONB bag keyed by category-specific field keys (warranty →
-- manufacturer/model/serial/purchase_date, insurance → provider/policy_no/premium,
-- vehicle → rego/make/model, lease → counterparty/property/start_date).
alter table documents
  add column if not exists metadata jsonb not null default '{}';
