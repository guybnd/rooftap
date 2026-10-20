-- HOUP-154: Expo push tokens for native task notifications. Sibling to
-- push_subscriptions (Web Push — NOT NULL endpoint/p256dh/auth, VAPID-shaped)
-- rather than an extension of it: an Expo push token is a single opaque
-- string with a platform and no keypair, so mixing the two shapes into one
-- table would need nullable web-push columns plus a discriminator. Both
-- tables feed sendToUsers() in supabase/functions/_shared/send-push.ts.
create table if not exists device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_device_push_tokens_user_id on device_push_tokens(user_id);
create index if not exists idx_device_push_tokens_group_id on device_push_tokens(group_id);

alter table device_push_tokens enable row level security;

-- A user manages only their own token rows. Sends run server-side with the
-- service role and intentionally bypass this policy.
create policy "Users manage their own device push tokens"
  on device_push_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
