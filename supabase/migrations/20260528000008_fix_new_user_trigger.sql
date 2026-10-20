-- Make the new-user trigger resilient: if group creation fails,
-- don't prevent the user from signing up. The frontend fallback
-- in data-cache.tsx will create the group instead.

create or replace function handle_new_user_group()
returns trigger
language plpgsql
security definer
as $$
declare
  new_group_id uuid;
begin
  if not exists (select 1 from group_members where user_id = new.id) then
    insert into groups (name, created_by)
    values ('My Group', new.id)
    returning id into new_group_id;

    insert into group_members (group_id, user_id, role)
    values (new_group_id, new.id, 'owner');
  end if;

  return new;
exception when others then
  return new;
end;
$$;
