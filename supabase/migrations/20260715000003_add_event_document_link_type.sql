-- FLUX-249: allow `document_links` to attach a document to a group `event`
-- (e.g. a doctor's referral PDF), reusing the central `documents` store.
-- Mirrors the drop-then-re-add pattern from 20260712000002.
alter table document_links drop constraint if exists document_links_entity_type_check;
alter table document_links add constraint document_links_entity_type_check
  check (entity_type in ('cost_item', 'grocery_session', 'setup_item', 'recipe', 'event'));
