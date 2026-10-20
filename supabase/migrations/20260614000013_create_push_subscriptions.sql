-- FLUX-128: Web Push subscriptions for mobile/desktop task notifications.
-- One row per browser/device push endpoint. A user may have several (phone,
-- laptop, …). Rows are personal: a user manages only their own, enforced via RLS
-- on auth.uid(). group_id is stored for convenient server-side fan-out (Edge
-- Functions run as service-role and bypass RLS, so they scope by user/assignee
-- explicitly — see supabase/functions/_shared/send-push.ts).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user_id on push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_group_id on push_subscriptions(group_id);

alter table push_subscriptions enable row level security;

-- A user manages only their own subscription rows. Sends run server-side with the
-- service role and intentionally bypass this policy.
create policy "Users manage their own push subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
