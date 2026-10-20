-- FLUX-202: allow `document_links` to attach a document to a recipe (the
-- scanned source photo), reusing the central `documents` store instead of a
-- new storage table. Mirrors the drop-then-re-add pattern from
-- 20260614000011.
alter table document_links drop constraint if exists document_links_entity_type_check;
alter table document_links add constraint document_links_entity_type_check
  check (entity_type in ('cost_item', 'grocery_session', 'setup_item', 'recipe'));
