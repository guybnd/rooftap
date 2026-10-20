-- FLUX-132: docs-centric pivot. Warranties/insurance/vehicle/lease are now just
-- documents (category + metadata + filtered views), so we retire the separate
-- warranty system and revert the unused tracked_items table (FLUX-131). No data
-- exists in any of these, so this is a clean drop.

-- Revert tracked_items (FLUX-131) — never used.
drop table if exists tracked_items cascade;

-- Drop the old warranty system (FLUX-72/73/75). warranty_files → warranty_assets.
drop table if exists warranty_files cascade;
drop table if exists warranty_assets cascade;

-- NOTE: the empty `warranty-files` storage bucket is intentionally left in place.
-- Supabase forbids direct DELETE on storage.objects/buckets from SQL migrations
-- ("Use the Storage API instead"); the bucket is unreferenced and harmless. Remove
-- it via the dashboard Storage UI or the Storage API if desired.

-- document_links no longer links to warranty assets or tracked items.
alter table document_links drop constraint if exists document_links_entity_type_check;
alter table document_links add constraint document_links_entity_type_check
  check (entity_type in ('cost_item','grocery_session','setup_item'));
