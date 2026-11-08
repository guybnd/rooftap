-- A stale offline edit no longer brings back a deleted row.
--
-- The synced stores push every create and update as a full-row upsert. When
-- device A deletes a row (deleted = true) while device B is offline, and B
-- then edits its old copy, B's upsert carries deleted = false and the row came
-- back for everyone. B's copy also carries the updated_at it last saw, which
-- is older than the delete.
--
-- handle_times() runs before every insert and update on the synced tables, and
-- it already overwrites updated_at. It now looks at the stamp the client sent
-- first: an update that turns deleted from true to false with a stamp more
-- than one second older than the row's is a stale edit, so the row stays
-- deleted. The other fields still save, and the client gets the row back with
-- deleted = true, so it drops the row too.
--
-- A real restore (Undo, the bin, re-using a deleted row) comes from a device
-- that has the row's latest stamp, so it still works. An update that sends no
-- stamp is not judged. The one-second margin covers a client that keeps the
-- stamp at millisecond precision.
--
-- Tables without a deleted column skip the check. Additive: the function keeps
-- its name and signature, and code that predates it behaves the same except
-- for this case.
create or replace function public.handle_times()
returns trigger
language plpgsql
as $$
declare
  old_row jsonb;
  new_row jsonb;
begin
  if (tg_op = 'INSERT') then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
  else
    -- keep-deleted guard (see 20261108170000_stale_update_keeps_delete.sql)
    old_row := to_jsonb(old);
    if old_row ? 'deleted' and (old_row ->> 'deleted')::boolean then
      new_row := to_jsonb(new);
      if not coalesce((new_row ->> 'deleted')::boolean, false)
        and new.updated_at is not null
        and old.updated_at is not null
        and new.updated_at < old.updated_at - interval '1 second' then
        new := jsonb_populate_record(new, jsonb_build_object('deleted', true));
      end if;
    end if;
    new.updated_at := now();
    new.created_at := old.created_at;  -- created_at is immutable
  end if;
  return new;
end;
$$;
