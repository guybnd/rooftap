# Supabase Edge Functions — Task Push Notifications (FLUX-128, HOUP-154)

Task push notifications, web (VAPID Web Push) and native (Expo Push). Sends
originate here (Deno). Web's subscribe/unsubscribe flow lives in the Next app
(`src/app/api/push/subscribe/route.ts` + `src/components/notifications-settings.tsx`),
and the service worker (`src/app/sw.ts`) renders the notification and handles
taps. Native's device-token registration is `apps/web/src/app/api/push/device-token/route.ts`
(called from `apps/mobile/src/features/settings/panels/notifications-settings.tsx`),
and the on-device receive/tap handling is
`apps/mobile/src/lib/use-push-notification-routing.ts`. Both transports read
from the same three notify-* functions below via `sendToUsers()`.

## Functions

| Function | Trigger | What it does |
|----------|---------|--------------|
| `notify-due-tasks` | `pg_cron` daily (22:00 UTC) | Pushes a reminder to the assignee of each open task due today/tomorrow. |
| `notify-upcoming-events` | `pg_cron` daily (22:00 UTC) | Pushes calendar event reminders, a week and a day before by default (`events.reminder_days`), to the household (or the creator, for a private event), in each reader's timezone, with the forecast at the household's home (Open-Meteo). |
| `notify-leave-time` | `pg_cron` every 5 minutes | Pushes "Leave by 6:40pm" for events with a travel mode, using the travel time from home saved on the event (`events.travel_minutes`), each reader's own lead time before leaving (`user_settings.leave_alert_minutes`, 30 or 60, default 60), once per person per start time (`event_leave_notices`). |
| `notify-task-assigned` | DB trigger on `household_tasks` (assigned_to change) | Pushes "assigned to you" to the new assignee. |
| `notify-task-comment` | DB trigger on `household_task_comments` (insert) | Pushes "new comment" to the task assignee + prior commenters, minus the author. |
| `_shared/send-push.ts` | — | Shared VAPID setup + web-push subscription lookup/send/pruning, and Expo push token lookup/send/pruning (`sendExpoPush`); `sendToUsers()` fans out to both. |
| `_shared/modules.ts`, `_shared/module-rules.ts` | — | The household's enabled modules (`group_modules` plus the server's `HOMEUP_MODULES`) and which module owns a task. `module-rules.ts` is the Deno twin of core's rules; `packages/core/src/task-modules.test.ts` checks the two agree. `calendar-push` and `calendar-sync` use them too, so Google Calendar sync follows modules. |

All payloads carry a stable `tag` (`due-`/`assigned-`/`comment-` + task id) so
one logical notification dedupes across a user's devices, and deep-link to
`/tasks?focus=<taskId>`.

**Modules** ([.docs/modules.md](../../.docs/modules.md)): a task notifies only
while the module that owns it is on. Bill and document reminders belong to
Costs and Documents, so with Tasks off they still notify, titled "Reminder",
and open `/costs` or `/documents` instead of the task.

## One-time setup

### 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

Put the **public** key in the Next app env and ship it to the client; keep the
**private** key server-side only.

`.env.local` (Next):

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public>
```

> The Next app only needs the public key — it never sends pushes, only stores
> subscriptions. `SUPABASE_SERVICE_ROLE_KEY` must also be set for the subscribe route.

### 2. Set Edge Function secrets

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<public> \
  VAPID_PRIVATE_KEY=<private> \
  VAPID_SUBJECT=mailto:you@example.com
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

### 3. Configure Vault secrets for the DB → function calls (Phase 2 + cron)

**Hosted Supabase only.** On the self-hosted compose stack (`.docs/self-hosting.md`)
this step runs automatically — `scripts/apply-migrations.sh` seeds both secrets
on first boot. Only follow this step against a hosted Supabase project.

The triggers and the cron job call the functions through `pg_net`, reading the
project URL and a service-role key from Supabase Vault. Run once (SQL editor):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service-role-key>',               'service_role_key');
```

Until both exist, `public.notify_edge_function` is a safe no-op (it logs a notice
and never blocks the task write).

**Rotation caveat (self-host):** the auto-seed only creates, never updates —
if you regenerate `SERVICE_ROLE_KEY` against an existing `db-data` volume, the
seeded `service_role_key` row goes stale and push notifications 401 with no
new warning. `.env.example` already says never to regenerate that key; if you
must, update the Vault row by hand with `select vault.update_secret(...)` (or
delete and re-run the seed).

### 4. Deploy

On hosted Supabase, CI deploys every function here on each merge to `main`
that touches `supabase/functions/` (the `functions` job, `.docs/deployment.md`),
and a manual dispatch of the CI workflow on `main` redeploys them. By hand:

```bash
supabase functions deploy notify-due-tasks
supabase functions deploy notify-task-assigned
supabase functions deploy notify-task-comment
supabase db push   # applies migrations: push_subscriptions + triggers/cron
```

**Caller authorization.** `verify_jwt` stays enabled (the default), but it is *not*
sufficient on its own — it accepts any project-signed JWT, including the public anon
key shipped to every browser. So each function additionally calls `requireServiceRole`
(`_shared/send-push.ts`) and rejects (401) any request whose bearer is not the
service-role key. The triggers and cron send the service-role key via `pg_net`, so
they pass; arbitrary callers with only the anon key cannot push to users.

## Deploy-time validation checklist

These cannot be exercised under `next dev` (the service worker is disabled in
dev) or without a deployed Supabase project, so validate them after deploy:

1. **⚠️ Deno web-push (main flagged risk).** `_shared/send-push.ts` imports
   `npm:web-push`. If the deployed Edge runtime rejects it (Node-crypto/https
   incompat), swap to the pure-Deno fallback **`jsr:@negrel/webpush`** — note that
   it needs VAPID keys in **JWK** form (generate with its
   `cmd/generate-vapid-keys.ts`) rather than the base64url form used here.
   Quick check: invoke `notify-due-tasks` and confirm a 200 + a delivered push.
2. **Subscribe flow** (Android/desktop Chrome, prod build over HTTPS): Settings →
   Notifications → On → accept the prompt → a `push_subscriptions` row appears.
3. **Click-through:** trigger a push and confirm tapping it opens `/tasks` with the
   correct task focused.
4. **Phase 2:** reassign a task / add a comment → the right recipient is pushed,
   the actor is not.
5. **Daily job:** `select * from cron.job;` shows `notify-due-tasks-daily`; run it
   manually with `select cron.schedule(...)`-equivalent or invoke the function
   directly to confirm.
6. **Pruning:** unsubscribe in the browser, then send → the stale row is deleted
   (web-push 404/410 path).
7. **iOS:** only delivers to a PWA added to the Home Screen (iOS 16.4+). In iOS
   Safari the settings toggle is replaced by an "Add to Home Screen" hint.

## Local testing

```bash
supabase functions serve notify-due-tasks --env-file ./supabase/.env.local
curl -X POST http://localhost:54321/functions/v1/notify-due-tasks
```
