-- Household invite links, and deleting an account (independent review n1, n7).
--
-- 1. An owner can make one invite link for their household. Whoever opens it
--    can join, also a person with no account yet: the web app's
--    /api/invite/account route checks the link and creates the account with
--    the service role, so this works on a self-hosted server where sign-up is
--    closed. A link lasts 30 days, makes at most 20 accounts, and a new link
--    replaces the old one. The token is never readable through the Data API:
--    the table is reached only through the functions below.
--
-- 2. join_household_by_invite moves the caller into the link's household.
--    A household they shared with others keeps going without them (the
--    longest-standing member becomes owner when they were the only one). A
--    household they had alone is deleted when it holds nothing a person
--    entered. When it does hold their things, nothing is deleted: the caller
--    gets a normal invitation instead, and accepts it in Settings > Home,
--    where they choose what happens to their old household.
--
-- 3. prepare_account_deletion(user) runs before the web app deletes an
--    account with the auth admin API. Without it the delete cascades through
--    every row the person created, so a shared household lost its costs,
--    documents and setup items, and the household itself when the person had
--    made it (groups.created_by cascades). Now, in each household the person
--    shares, the rows they created pass to the household's owner and the
--    longest-standing member becomes owner when needed. Households the person
--    had alone are deleted. Their own comments, settings and connections go
--    with the account.
--
-- Additive and safe ahead of code: one new table with no client grants, and
-- new functions only. Older app code calls none of it.

-- 1 ------------------------------------------------------------------------
create table if not exists public.household_invite_links (
  group_id uuid primary key references public.groups(id) on delete cascade,
  token text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  accounts_made integer not null default 0,
  joined integer not null default 0
);

alter table public.household_invite_links enable row level security;
-- No policies: clients reach the table only through the functions below.
grant select, insert, update, delete on public.household_invite_links to service_role;

/** The live link for a household the caller owns, made (or replaced) on request. */
create or replace function public.household_invite_link(p_group_id uuid, p_renew boolean default false)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  link record;
begin
  if not exists (
    select 1 from group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'Only an owner can invite people' using errcode = '42501';
  end if;

  select * into link from household_invite_links l where l.group_id = p_group_id;
  if not found or p_renew or link.expires_at <= now() then
    insert into household_invite_links as l (group_id, token, created_by)
    values (p_group_id, replace(gen_random_uuid()::text, '-', ''), auth.uid())
    on conflict (group_id) do update
      set token = excluded.token,
          created_by = excluded.created_by,
          created_at = now(),
          expires_at = now() + interval '30 days',
          accounts_made = 0,
          joined = 0
    returning * into link;
  end if;

  return query select link.token, link.expires_at;
end;
$$;

/** Turns a household's invite link off. */
create or replace function public.stop_household_invite_link(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'Only an owner can invite people' using errcode = '42501';
  end if;
  delete from household_invite_links where group_id = p_group_id;
end;
$$;

/**
 * Whether a household holds anything a person entered. Settings rows the apps
 * write on their own (modules, aisles, assistant settings) don't count.
 */
create or replace function public.household_has_things(p_group_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t text;
  found_one boolean;
begin
  foreach t in array array[
    'household_tasks', 'events', 'grocery_items', 'recipes', 'meal_plan_entries',
    'cost_items', 'documents', 'checklists', 'setup_items', 'care_jobs', 'occasions',
    'gift_ideas', 'wishlist_items', 'loyalty_cards', 'reward_schemes', 'bin_plans',
    'apartments', 'saved_searches', 'assistant_conversations', 'shopper_wants',
    'bank_transactions'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select exists (select 1 from public.%I where group_id = $1)', t)
      into found_one using p_group_id;
    if found_one then return true; end if;
  end loop;
  return false;
end;
$$;

/**
 * What an invite link opens: the household's name, who made the link and how
 * many people are in it. For a signed-in caller, `fit` says what joining does:
 * 'member' (already in it), 'fresh' (nothing to lose), 'leave' (leaves a
 * household shared with others) or 'has_things' (their own household holds
 * things, so they get an invitation to accept in Settings). No row for an
 * unknown token.
 */
create or replace function public.peek_household_invite(p_token text)
returns table (household text, invited_by text, members integer, expired boolean, fit text, current_household text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link record;
  mine record;
  others integer;
begin
  select * into link from household_invite_links l where l.token = p_token;
  if not found then return; end if;

  household := (select g.name from groups g where g.id = link.group_id);
  invited_by := coalesce((
    select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')
    from auth.users u where u.id = link.created_by
  ), '');
  members := (select count(*)::integer from group_members m where m.group_id = link.group_id);
  expired := link.expires_at <= now();
  fit := null;
  current_household := null;

  if auth.uid() is not null then
    if exists (select 1 from group_members m where m.group_id = link.group_id and m.user_id = auth.uid()) then
      fit := 'member';
    else
      fit := 'fresh';
      for mine in
        select m.group_id, g.name from group_members m join groups g on g.id = m.group_id
        where m.user_id = auth.uid()
        order by m.joined_at desc
      loop
        current_household := coalesce(current_household, mine.name);
        select count(*) into others from group_members m
        where m.group_id = mine.group_id and m.user_id <> auth.uid();
        if others > 0 then
          if fit = 'fresh' then fit := 'leave'; end if;
        elsif household_has_things(mine.group_id) then
          fit := 'has_things';
        end if;
      end loop;
    end if;
  end if;

  return next;
end;
$$;

/** Leaves a household that others stay in, handing ownership on when needed. */
create or replace function public.leave_shared_household(p_user uuid, p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  heir uuid;
begin
  select m.user_id into heir from group_members m
  where m.group_id = p_group_id and m.user_id <> p_user
  order by (m.role = 'owner') desc, m.joined_at asc
  limit 1;

  if heir is null then return null; end if;

  if not exists (
    select 1 from group_members m
    where m.group_id = p_group_id and m.user_id <> p_user and m.role = 'owner'
  ) then
    update group_members set role = 'owner' where group_id = p_group_id and user_id = heir;
  end if;

  delete from group_members where group_id = p_group_id and user_id = p_user;
  return heir;
end;
$$;

/**
 * Joins the link's household. Returns 'joined', 'already_member' or 'invited'
 * (see the header). Raises invite_not_found or invite_expired.
 */
create or replace function public.join_household_by_invite(p_token text)
returns text
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  link record;
  mine record;
  others integer;
  inviter uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select * into link from household_invite_links l where l.token = p_token for update;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if link.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  if exists (select 1 from group_members m where m.group_id = link.group_id and m.user_id = auth.uid()) then
    return 'already_member';
  end if;

  -- A household the caller has alone with their things in it is never
  -- deleted here: they get an invitation and choose in Settings.
  for mine in select m.group_id from group_members m where m.user_id = auth.uid() loop
    select count(*) into others from group_members m
    where m.group_id = mine.group_id and m.user_id <> auth.uid();
    if others = 0 and household_has_things(mine.group_id) then
      inviter := coalesce(
        (select m.user_id from group_members m where m.group_id = link.group_id and m.user_id = link.created_by),
        (select m.user_id from group_members m where m.group_id = link.group_id and m.role = 'owner' order by m.joined_at limit 1)
      );
      insert into group_invitations (group_id, invited_by, invited_user_id)
      values (link.group_id, inviter, auth.uid())
      on conflict (group_id, invited_user_id) where status = 'pending' do nothing;
      return 'invited';
    end if;
  end loop;

  for mine in select m.group_id from group_members m where m.user_id = auth.uid() loop
    select count(*) into others from group_members m
    where m.group_id = mine.group_id and m.user_id <> auth.uid();
    if others > 0 then
      perform leave_shared_household(auth.uid(), mine.group_id);
    else
      delete from groups where id = mine.group_id;
    end if;
  end loop;

  insert into group_members (group_id, user_id, role)
  values (link.group_id, auth.uid(), 'member');

  update household_invite_links set joined = joined + 1 where group_id = link.group_id;
  return 'joined';
end;
$$;

/**
 * Checks a link before /api/invite/account makes an account with it, and
 * counts the account. Service role only. Returns false for an unknown,
 * expired or used-up link.
 */
create or replace function public.claim_invite_account(p_token text)
returns boolean
language plpgsql
security definer
volatile
set search_path = public
as $$
begin
  update household_invite_links
  set accounts_made = accounts_made + 1
  where token = p_token and expires_at > now() and accounts_made < 20;
  return found;
end;
$$;

-- 3 ------------------------------------------------------------------------
/**
 * What deleting the caller's account does to each of their households:
 * 'deleted' (they are its only member) or 'handed_over' (it stays, `heir`
 * names who owns it after).
 */
create or replace function public.account_deletion_plan_for(p_user uuid)
returns table (group_id uuid, household text, outcome text, heir text)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.name,
    case when h.user_id is null then 'deleted' else 'handed_over' end,
    case when h.user_id is null then null else coalesce(
      nullif(u.raw_user_meta_data->>'full_name', ''),
      nullif(u.raw_user_meta_data->>'name', ''),
      u.email::text
    ) end
  from group_members mine
  join groups g on g.id = mine.group_id
  left join lateral (
    select m.user_id from group_members m
    where m.group_id = mine.group_id and m.user_id <> p_user
    order by (m.role = 'owner') desc, m.joined_at asc
    limit 1
  ) h on true
  left join auth.users u on u.id = h.user_id
  where mine.user_id = p_user
  order by mine.joined_at desc;
$$;

create or replace function public.account_deletion_plan()
returns table (group_id uuid, household text, outcome text, heir text)
language sql
stable
security definer
set search_path = public
as $$
  select * from account_deletion_plan_for(auth.uid());
$$;

/**
 * Gets a person's account ready for the auth admin delete. Service role only.
 * Returns the ids of the households it deleted, so the caller can remove their
 * files from storage.
 */
create or replace function public.prepare_account_deletion(p_user uuid)
returns uuid[]
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  g record;
  heir uuid;
  deleted uuid[] := '{}';
  col record;
begin
  -- Households the person is in.
  for g in select m.group_id from group_members m where m.user_id = p_user loop
    heir := leave_shared_household(p_user, g.group_id);
    if heir is null then
      deleted := deleted || g.group_id;
      delete from groups where id = g.group_id;
      continue;
    end if;

    -- What they added stays with the household, under the heir's name.
    for col in
      select * from (values
        ('agents', 'user_id'), ('apartments', 'user_id'), ('appointments', 'user_id'),
        ('checklist_items', 'user_id'), ('saved_searches', 'created_by'),
        ('setup_items', 'created_by'), ('setup_stores', 'created_by'),
        ('cost_items', 'created_by'), ('documents', 'uploaded_by'),
        ('document_folders', 'created_by')
      ) as c(tbl, who)
    loop
      if to_regclass('public.' || col.tbl) is null then continue; end if;
      execute format('update public.%I set %I = $1 where group_id = $2 and %I = $3', col.tbl, col.who, col.who)
        using heir, g.group_id, p_user;
    end loop;
    update cost_documents set uploaded_by = heir
    where uploaded_by = p_user
      and cost_item_id in (select ci.id from cost_items ci where ci.group_id = g.group_id);
  end loop;

  -- Households they made and left earlier: the oldest owner (else member) takes them on.
  update groups gr set created_by = coalesce(
    (select m.user_id from group_members m where m.group_id = gr.id order by (m.role = 'owner') desc, m.joined_at asc limit 1),
    gr.created_by
  )
  where gr.created_by = p_user;

  -- One they made and nobody is in any more goes with them.
  delete from groups gr
  where gr.created_by = p_user
    and not exists (select 1 from group_members m where m.group_id = gr.id);

  return deleted;
end;
$$;

-- Grants ---------------------------------------------------------------------
revoke all on function public.household_invite_link(uuid, boolean) from public, anon;
revoke all on function public.stop_household_invite_link(uuid) from public, anon;
revoke all on function public.household_has_things(uuid) from public, anon, authenticated;
revoke all on function public.peek_household_invite(text) from public;
revoke all on function public.leave_shared_household(uuid, uuid) from public, anon, authenticated;
revoke all on function public.join_household_by_invite(text) from public, anon;
revoke all on function public.claim_invite_account(text) from public, anon, authenticated;
revoke all on function public.account_deletion_plan_for(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_plan() from public, anon;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;

grant execute on function public.household_invite_link(uuid, boolean) to authenticated;
grant execute on function public.stop_household_invite_link(uuid) to authenticated;
grant execute on function public.peek_household_invite(text) to anon, authenticated;
grant execute on function public.join_household_by_invite(text) to authenticated;
grant execute on function public.account_deletion_plan() to authenticated;
grant execute on function public.household_has_things(uuid) to service_role;
grant execute on function public.leave_shared_household(uuid, uuid) to service_role;
grant execute on function public.claim_invite_account(text) to service_role;
grant execute on function public.account_deletion_plan_for(uuid) to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
