-- Expose a minimal view of auth.users for email-based group invites.
-- Only authenticated users can query it (RLS on the underlying view).

create or replace view auth_users_view as
select id, email from auth.users;

-- Grant access to authenticated role
grant select on auth_users_view to authenticated;
