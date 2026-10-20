-- FLUX-202: "Scan a recipe" — AI photo parse into a draft recipe.
--
-- Additive columns on `recipes` only; the existing trigger/index/realtime-
-- publication contract (20260711000003) is untouched, so offline sync keeps
-- working unmodified.
--
-- `draft` gates visibility: a scanned recipe is written immediately
-- (draft=true) so the in-progress review is crash-safe and the source photo
-- has a recipe id to link against, then flips to false on Save. Drafts are
-- filtered out of the normal list in app code (mirrors `deleted`).
--
-- `source` + `source_type` record provenance so a future URL/PDF importer
-- needs no further migration — it just writes a different `source_type` +
-- `source` and reuses this same parse/draft/review pipeline. This ticket only
-- ever writes 'photo' (scans) and 'manual' (hand entry).
alter table recipes
  add column if not exists servings int,
  add column if not exists prep_minutes int,
  add column if not exists cook_minutes int,
  add column if not exists source text,
  add column if not exists source_type text check (source_type in ('photo', 'pdf', 'url', 'manual')),
  add column if not exists draft boolean not null default false;
