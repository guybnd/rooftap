-- FLUX-240: collapse setup_items.status from 5 values to 2 (needed / installed,
-- relabeled "Got It" in the UI). Existing researching/ordered/delivered rows have
-- no money spent yet in practice, so they map to 'needed'.
update setup_items
  set status = 'needed'
  where status in ('researching', 'ordered', 'delivered');

alter table setup_items drop constraint setup_items_status_check;
alter table setup_items add constraint setup_items_status_check
  check (status in ('needed', 'installed'));
