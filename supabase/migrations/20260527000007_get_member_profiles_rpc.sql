create or replace function get_member_profiles(member_ids uuid[])
returns table(id uuid, email text, display_name text, avatar_url text)
language sql
security definer
stable
as $$
  select
    u.id,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')::text as display_name,
    coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '')::text as avatar_url
  from auth.users u
  where u.id = any(member_ids);
$$;

grant execute on function get_member_profiles(uuid[]) to authenticated;
