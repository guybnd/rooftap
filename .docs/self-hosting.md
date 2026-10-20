# Self-hosting Rooftap

> **TL;DR** — `./scripts/self-host-init.sh -d` brings up Rooftap plus a bundled
> self-hosted Supabase stack on your own machine. No cloud account, no
> external signup. Sign in with a local email/password account — Google
> sign-in and Calendar sync are optional add-ons, not required.

## Quick start

```bash
git clone <this repo> && cd homeup
cp .env.example .env
# Optional: set NEXT_PUBLIC_MAPBOX_TOKEN (https://account.mapbox.com/access-tokens/)
# for maps, geocoding and directions; without it those views are hidden.
# Secrets (POSTGRES_PASSWORD, JWT keys, ...) are generated on first run, and
# everything else has a working default or is optional, see .env.example.
./scripts/self-host-init.sh -d
```

Then open <http://localhost:3000>, create an account (email/password), and
you're in — zero external accounts required.

**Always run `./scripts/self-host-init.sh`, not `docker compose up` directly.**
The script fixes up first-boot secrets in `.env` *before* any container
starts; running `docker compose up` on its own would start every service with
empty secrets baked in (see "First-boot provisioning" below for why this has
to happen outside a compose service).

## What's in the stack

One `docker-compose.yml` brings up:

| Service | Image | What it does |
|---|---|---|
| `app` | built from the repo's `Dockerfile` | The Next.js app itself |
| `db` | `supabase/postgres` | Postgres, with `pg_cron` + Vault preinstalled |
| `auth` | `supabase/gotrue` | Email/password + OAuth sessions |
| `rest` | `postgrest/postgrest` | Auto-generated REST API over Postgres |
| `realtime` | `supabase/realtime` | Live UI updates (Postgres replication) |
| `storage` | `supabase/storage-api` | File storage (photos, attachments) |
| `kong` | `kong` | API gateway — routes `/auth`, `/rest`, `/realtime`, `/storage`, `/functions` |
| `edge-runtime` | `supabase/edge-runtime` | Runs the Deno edge functions under `supabase/functions/` (notifications, calendar sync) |
| `migrate` | one-shot | Applies all `supabase/migrations/*.sql` against `db`, then exits |

This is the same self-hosted Supabase topology Supabase itself documents and
ships (trimmed here to the pieces Rooftap actually uses — no Studio dashboard,
pg-meta, image transforms, or Supavisor pooler; single-operator scale doesn't
need a connection pooler in front of Postgres).

## First-boot provisioning

On the very first `./scripts/self-host-init.sh` run, it generates:
- `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` — the signing key and derived
  API keys hosted Supabase normally hands you from a dashboard.
- `POSTGRES_PASSWORD` — the database superuser password.
- `SECRET_KEY_BASE` — the Realtime (Phoenix) session-signing secret.
- `REALTIME_DB_ENC_KEY` — Realtime's fixed-width (16-char) encryption key.

All six are written into the `.env` file at the repo root.

**These are never regenerated on a later boot.** Every session cookie and
every RLS-signed request is cryptographically tied to `JWT_SECRET`; every
Postgres role's password is tied to `POSTGRES_PASSWORD`; every live Realtime
connection is tied to `SECRET_KEY_BASE`/`REALTIME_DB_ENC_KEY`. Regenerating
any of these on an existing install would invalidate every session and lock
every service out of the database (or Realtime). `./scripts/self-host-init.sh`
checks whether these are already set before generating anything — a normal
`down && up` (or re-running the script) reuses what's already there and does
nothing.

**Back up your `.env` file** along with the Postgres volume (see "Backups"
below) — losing it means losing access to existing sessions and the ability
for services to re-authenticate to `db`.

Why this can't be a step inside `docker-compose.yml` itself: Compose expands
`${VAR}` references in the compose file exactly once, before any container
starts. Generating these values from inside a container (e.g. an `init`
service) would be too late — every other service would already have started
with the empty placeholder values baked in. `scripts/self-host-init.sh` fixes
`.env` up on the host first, then execs `docker compose up` for you.

## Migrations and edge functions — fully automatic

The `migrate` service applies every file in `supabase/migrations/` against
`db` on every `docker compose up`, tracking what's already applied so
re-running against an existing data volume is a no-op. It also seeds the two
Supabase Vault secrets (`project_url`, `service_role_key`) the push-notification
triggers and cron job need — see "Push notifications" below. `edge-runtime`
serves every edge function under `supabase/functions/` (`calendar-push`,
`calendar-sync`, `main`, `notify-due-tasks`, `notify-task-assigned`,
`notify-task-comment` — see `supabase/functions/README.md`) directly from the
repo. No manual operator step, no `supabase db push`, no `supabase functions
deploy`, no manual Vault SQL — normal migration count vs. a squashed baseline
makes no difference here (see FLUX-1561 for why the migrations stay
unsquashed; a separate ticket, HOUP-16, tracks squashing them for unrelated
maintenance reasons).

## Push notifications — auto-seeded Vault secrets (HOUP-309)

`public.notify_edge_function` (the trigger/cron path that calls the
`notify-*` edge functions) reads its target URL and auth key from Supabase
Vault, not from `.env` — Postgres runs inside the `db` container, so it needs
the in-network gateway address (`http://kong:8000`), not the browser-facing
`NEXT_PUBLIC_SUPABASE_URL`. `scripts/apply-migrations.sh` seeds both
`vault.decrypted_secrets` rows (`project_url`, `service_role_key`)
automatically on first boot, after migrations apply; re-running on an
existing volume is a no-op (check-then-create). A seed failure logs a warning
in the `migrate` service's logs and names the manual SQL fallback in
`supabase/functions/README.md` — it never blocks the container from starting.

## Auth: first user, then locked

The bundled `auth` service has Supabase's Email provider enabled, but
registration is **open only until the first account exists, then closed at
the auth server itself** (`GOTRUE_DISABLE_SIGNUP` defaults to `true` in
`docker-compose.yml`). `src/app/(auth)/login/page.tsx` is sign-in only — it
has no signup form. Since there's no SMTP server configured (a
zero-external-account install has nowhere to send confirmation emails from),
that first account is auto-confirmed and gets a session immediately.

**First-run welcome screen:** a fresh install with zero accounts is routed to
`src/app/(auth)/welcome/page.tsx` instead of the bare login form (checked via
the unauthenticated `GET /api/setup/status`, which reports only whether any
account exists). It calls the service-role-backed `POST /api/setup/first-user`
to create that first account and signs the operator in; once any account
exists, `/welcome` redirects to `/login`, and the route itself returns `409`
for any further attempt — so the first-run door can't be reused, even by a
direct request. Every account after that is minted by the owner from the
**Settings → Users** admin screen (`POST /api/admin/users`, gated on
`requireOwner`), which still works with signup disabled — it goes through
the service-role admin client, not the public signup endpoint GoTrue closes.

**Reopening registration:** set `GOTRUE_DISABLE_SIGNUP=false` in `.env` and
restart the `auth` container (`docker compose up -d auth`). This is a
deliberate, host-level decision — there is no in-app toggle, so a compromised
admin session can't reopen registration on its own.

**Upgrading an existing install:** if you deployed Rooftap before this change,
your instance had open signup by default. Pulling this update **closes
signup on the next `auth` container restart** — anyone who hasn't already
created an account will need one minted by the owner afterward. If you
*want* to keep registration open (e.g. a trusted household still onboarding
people), set `GOTRUE_DISABLE_SIGNUP=false` in `.env` before restarting.

**Sole-owner password recovery:** there's no mailer, so the owner account has
no "forgot password" email flow. If the owner is locked out, reset the
password directly against the database with the Supabase CLI/`auth.admin`
API (e.g. `admin.auth.admin.updateUserById(ownerId, { password })` run from a
one-off script with the service-role key) or, in the worst case, connect to
the `db` container's Postgres directly. There is no UI path for this by
design — it requires host/database access, matching who is actually trusted
to recover a sole owner's account.

**Local username login:** GoTrue always requires an email, even for
local-only accounts, so an identifier typed with no `@` is treated as a
username and mapped to `<username>@homeup.local` before it ever reaches
Supabase auth (see `packages/core/src/auth/identifier.ts`). The operator only
ever types/sees the username; a real email still works unchanged.
`@homeup.local` is never routable and used only as an internal auth
identifier.

**Google sign-in** stays optional, but closing signup changes what it can do:
configure `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env` **and**
uncomment the matching `GOTRUE_EXTERNAL_GOOGLE_*` lines in
`docker-compose.yml`'s `auth` service, and Google sign-in works for **an
account that already exists** — it can no longer create a new one, since
GoTrue's external-provider new-user path is gated by the same
`GOTRUE_DISABLE_SIGNUP` flag as public signup. Skip Google entirely and the
app works with zero Google config.

**Onboarding a household member who wants to use Google:** the owner creates
that person's account from **Settings → Users**, using their **real Google
email address** as the identifier (not a username). At sign-in, GoTrue
matches the existing account by email instead of attempting a new signup, so
"Continue with Google" signs them straight in. This repo has no identity
linking (a Google account attaching to an already-existing password account)
— that's a Phase 2 item — so the email match above is the only route in; it
has not been verified against a running stack as part of this change, so
treat it as expected-but-unconfirmed behavior until checked live.

**Calendar sync caveat:** connecting Google Calendar only works while signed
in *as* that same Google account — the `calendar-callback` route's
`account_mismatch` guard blocks linking a Google Calendar to an
email/password-authenticated session. Identity-linking to lift this is a
Phase 2 item, not part of this self-hosting work.

**Dev/bypass login:** the existing "Dev access" toggle on the login page stays
available as an opt-in escape hatch. It's hardened — set both
`BYPASS_USERNAME` and `BYPASS_PASSWORD` in `.env` to enable it; unset (the
default), the route refuses with a `503`. **This applies to the existing
Vercel-hosted deployment too** — if it relies on the bypass route, set both
env vars there or that login path stops working after this change.

**Seeded `@homeup.local` accounts and mobile (HOUP-180):** `/api/auth/bypass`
(web-only) mints a real Supabase Auth password on the seeded
`<BYPASS_USERNAME>@homeup.local` account via `auth.admin.createUser({
password: BYPASS_PASSWORD, ... })` on first creation — it does **not**
rotate the password on subsequent calls if the account already exists, so
changing `BYPASS_PASSWORD` after the account was first created has no effect
until the account is deleted and recreated, or the password is reset
directly via `auth.admin.updateUserById`. There is no separate mobile bypass
path; the same `<username>@homeup.local` + `BYPASS_PASSWORD` credentials work
through mobile's normal password sign-in (`apps/mobile/src/app/login.tsx`) —
confirmed via live device repro (HOUP-176/HOUP-180) that the seeded account
authenticates fine. A prior report of this account landing on a dead
"No group selected" screen on mobile was **not** an auth/password problem —
it was mobile's data cache never refetching after login (fixed by HOUP-177/
HOUP-178, the persistent auth guard + `onAuthStateChange`-driven refetch).

## Setting API keys from the UI

**Server operators only (HOUP-242):** this config is server-global — it
changes behavior for every household on this deployment, not just the
caller's own group — so it's gated on server-operator identity, not group
ownership. A group owner is not automatically a server operator. Set
`SERVER_OPERATOR_EMAILS` (comma-separated) in `.env`/`.env.local` to name
which signed-in emails may manage it; unset means no one can, and the panel
is hidden. This allowlist is deploy-time-only — it is never readable or
settable from any in-app UI, admin API, or database row, so a user signing
into someone else's instance and adding their own email in-app has no path
to becoming an operator of that instance.

Operators can enter optional third-party keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `SCRAPER_API_KEY`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) from **Settings → API keys** instead
of hand-editing `.env` and restarting. A saved key is stored in the
service-role-only `admin_config` table and takes effect on the very next
request; leaving a key unset falls back to its `.env` value exactly as before.
`NEXT_PUBLIC_MAPBOX_TOKEN` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` appear in the
same panel read-only, since Next.js inlines them into the browser bundle at
`next build` (see the trade-off below).

**Testing a key (HOUP-46):** each row has a "Test" button that calls a free,
non-billable metadata endpoint for that provider (`POST /api/admin/keys/test`,
validators in `src/lib/key-validation.ts`) and reports Valid, Invalid, No
credit, or Unreachable. The test resolves the key the same way a real request
would — the stored `admin_config` row first, then `.env` — so it catches a
stale stored key that's silently shadowing a key you just corrected in
`.env`. Tests are on-demand only, never run automatically on page load.

**Parsing provider (HOUP-43):** the same panel has a "Parsing provider"
selector — OpenAI / OpenRouter / Gemini / Anthropic — that routes **all**
parsing (listings, receipts, recipes) through one provider, stored as the
`AI_PARSING_PROVIDER` row in `admin_config` (`src/lib/admin-config.ts`
`resolveParsingProvider`). Left on Default (unset), behavior is unchanged:
listings/receipts use OpenAI and recipes use Gemini. The four adapters and the
canonical-schema-to-native-dialect translation live in `src/lib/ai/providers.ts`.

**Edge-function caveat:** the `edge-runtime` service's Deno functions
(`calendar-sync`, `calendar-push`, etc.) read their **own** `.env`-sourced
environment directly, not `admin_config`. A Google key set from this UI only
takes effect on the Next.js app's own server routes — concretely, the
access-token refresh path in `src/lib/google-calendar.ts`. The initial OAuth
code-exchange step, if it runs inside an edge function, is unaffected by a
UI-set key and still needs the value in `.env` and `docker-compose.yml`.

## Choosing which modules your server offers

Every feature (Tasks, Calendar, Groceries, Home Search and so on) is a module
([modules.md](modules.md)). By default a server offers all of them, and each
household's owner turns them on or off in **Settings → Modules**. To offer
fewer, set `HOMEUP_MODULES` in `.env` to a comma-separated list of ids
(`household,calendar,checklists,documents,groceries,recipes,costs,setup,search`)
and restart the `app` and `edge-runtime` services (the edge functions read it
too, so notifications skip modules the server doesn't offer). A module left out
can't be switched on by any household. The list is read at runtime and reaches the native app through
`/api/public-config`, so the same store app works against every server and
nothing needs rebuilding.

## The `NEXT_PUBLIC_*` build-time trade-off

Next.js inlines `NEXT_PUBLIC_*` env vars into the JS bundle at `next build`
time — they can't be changed at runtime without rebuilding the image. This
creates a real wrinkle for self-hosting: `NEXT_PUBLIC_SUPABASE_URL` is used by
**both** the browser bundle and the app's own server-side code (middleware,
API routes), but a container on Docker's default bridge network can reach the
Supabase gateway at `http://kong:8000` while the browser (running on your
actual machine, not in a container) can only reach it at
`http://localhost:8000` — two different values for the one build-time var.

**Phase 1 fix (this ticket):** the `app` service runs with Docker's **host
networking** (`network_mode: host` in `docker-compose.yml`) instead of the
default bridge network. That makes `localhost:8000` resolve to the same place
for both the browser and the app's own server code, because "host networking"
means the container shares the host's network stack directly. This is exactly
suited to what self-hosting is here — one operator, one machine, nothing that
needs to reach the app from elsewhere on the network.

- **Linux:** works natively, no extra setup.
- **Mac/Windows (Docker Desktop):** enable **Settings → Resources → Network →
  Enable host networking** first, or the `app` container won't come up with
  working ports.

**Phase 2 (not built here):** a runtime env-injection shim (writing
`NEXT_PUBLIC_*` values into a script tag or config endpoint at request time
instead of baking them into the JS bundle) would let client and server use
different origins and drop the host-networking requirement — letting the app
run on the default bridge network like every other service. Out of scope for
this ticket; tracked as follow-up work if self-hosting needs to grow beyond
"my own machine" (e.g. LAN access from other devices).

## Mobile access (HOUP-69)

The store app has a first-run picker: "Official" or "my own server". It reads
`GET /api/public-config` from the server you enter to learn which Supabase
gateway and modules to use, so no custom app build is needed. Two things have
to be true for a phone to use it:

- **HTTPS.** Android release builds refuse plain `http://` to anything but
  localhost, so a LAN address like `http://192.168.1.20:3000` won't work.
- **One reachable origin.** `SUPABASE_PUBLIC_URL` is what the phone talks to
  for auth, data, realtime and storage. Left unset it falls back to
  `http://localhost:8000`, which on a phone is the phone itself.

The compose file ships three optional ways to solve both: one hostname, a
real certificate, Supabase's API paths (`/auth/v1`, `/rest/v1`,
`/realtime/v1`, `/storage/v1`, `/functions/v1`) routed to Kong and everything
else to the web app.

| Option | Profile | Needs | Phone needs |
|---|---|---|---|
| Tailscale Funnel | `tailscale-funnel` | a free Tailscale account | nothing |
| Cloudflare Tunnel | `cloudflare-tunnel` | a domain on Cloudflare | nothing |
| Public domain | `https` | a domain, ports 80 and 443 open | nothing |
| Private Tailscale | `https` | a Tailscale account | the Tailscale app |

The two tunnels open no ports on your router. The tunnel runs on the server,
takes care of HTTPS, and forwards to a small plain-HTTP Caddy on
`127.0.0.1:8088` (`docker/volumes/caddy/Caddyfile.tunnel`). Both put your
server on the public internet: the login page protects it, and registration
closes once the owner account exists.

### With Tailscale Funnel (no domain, no open ports)

1. In the [Tailscale admin console](https://login.tailscale.com/admin), turn
   on HTTPS certificates (DNS page) and make sure your access controls allow
   Funnel (new tailnets do by default; otherwise add the `funnel` node
   attribute).
2. Create an auth key (Settings, Keys). In `.env`:

   ```bash
   TS_AUTHKEY=tskey-auth-...
   TS_HOSTNAME=rooftap
   SUPABASE_PUBLIC_URL=https://rooftap.<tailnet>.ts.net
   SITE_URL=https://rooftap.<tailnet>.ts.net
   ```

   `<tailnet>` is your tailnet's DNS name from the DNS page.
3. `docker compose --profile tailscale-funnel up -d`. This adds its own
   Tailscale node named `rooftap`, separate from any Tailscale already
   running on the host. The auth key is only used on first start; the node
   is kept in the `tailscale-state` volume.

In the app, choose "my own server" and enter `https://rooftap.<tailnet>.ts.net`.

### With Cloudflare Tunnel (your domain, no open ports)

1. In the Cloudflare dashboard (Zero Trust, Networks, Tunnels), create a
   tunnel of type Cloudflared and copy its token.
2. Add a public hostname to the tunnel, for example `rooftap.example.com`,
   with service type `HTTP` and URL `127.0.0.1:8088`.
3. In `.env`:

   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   SUPABASE_PUBLIC_URL=https://rooftap.example.com
   SITE_URL=https://rooftap.example.com
   ```

4. `docker compose --profile cloudflare-tunnel up -d`.

In the app, choose "my own server" and enter `https://rooftap.example.com`.

### With a public domain

Point a DNS record at the host and open ports 80 and 443. In `.env`:

```bash
HOMEUP_DOMAIN=homeup.example.com
SUPABASE_PUBLIC_URL=https://homeup.example.com
SITE_URL=https://homeup.example.com
```

Then `docker compose --profile https up -d`. Caddy gets a Let's Encrypt
certificate on first start. In the app, choose "my own server" and enter
`https://homeup.example.com`.

### With Tailscale, private to your tailnet

Turn on HTTPS certificates for your tailnet (admin console, DNS page), then:

```bash
HOMEUP_DOMAIN=<machine>.<tailnet>.ts.net
SUPABASE_PUBLIC_URL=https://<machine>.<tailnet>.ts.net
SITE_URL=https://<machine>.<tailnet>.ts.net
```

Uncomment the `tailscaled.sock` volume on the `caddy` service so Caddy can
fetch the `*.ts.net` certificate from the local Tailscale daemon, then
`docker compose --profile https up -d`. Every phone needs the Tailscale app
running; use Funnel above if you'd rather it didn't.

### Installing the web app (PWA)

The `app` image is a production build, so it ships the web app manifest and
the offline service worker. Any browser that supports installable web apps can
add Rooftap to the home screen or desktop, where it opens in its own window,
keeps working offline from its cache, and shows up as a share target for
photos, PDFs and calendar files on Android.

Browsers only install a web app (and only run its service worker) on HTTPS.
`http://localhost:3000` counts as secure on the server itself, but every other
device needs the HTTPS setup above:

1. Bring up the `https` profile with a public domain or Tailscale name.
2. Set `NEXT_PUBLIC_SUPABASE_URL` to that same `https://` origin and rebuild
   with `./scripts/self-host-init.sh -d --build` (see the notes below). An
   `http://` value is blocked as mixed content inside the installed app.
3. Open `https://<your domain>` and install it:
   - **Android (Chrome, Edge, Samsung Internet):** menu, then **Install app**
     or **Add to Home screen**.
   - **iPhone and iPad (Safari):** Share, then **Add to Home Screen**.
   - **Desktop (Chrome, Edge):** the install icon at the right of the address
     bar. Firefox on desktop doesn't install web apps.

Browser push notifications are optional and need VAPID keys (see
`.env.example`). On iPhone they only work from the installed app, iOS 16.4 or
later.

### Notes

- **What was tested:** the compose stack ran with `HOMEUP_DOMAIN=localhost`
  (Caddy's own local CA). Through Caddy, on one origin:
  - `/api/public-config` returned `https://localhost` as the Supabase URL
  - a password sign-in worked
  - REST and storage calls worked with the user's token
  - realtime websockets connected
  - plain `http://` redirected to HTTPS

  That run used the web app on the host (`next start`), not the `app`
  container. Let's Encrypt, Tailscale and a real phone were not tested.
- **Tunnel profiles, what was tested:** the tunnel origin's Caddyfile was run
  against stub upstreams: API paths reached Kong, everything else the app,
  any public Host was accepted, and the tunnel's `X-Forwarded-Proto: https`
  was passed through. The Funnel and Cloudflare connectors themselves were
  not run.
- **The web UI from other devices** also needs `NEXT_PUBLIC_SUPABASE_URL` set
  to the same `https://` origin, followed by a rebuild
  (`./scripts/self-host-init.sh -d --build`). It's baked into the web bundle
  at build time (see "The `NEXT_PUBLIC_*` build-time trade-off" above). The
  phone doesn't need this, because it reads the runtime value.
- **Push notifications** to the store app go through Expo's push service
  (`exp.host`) under the official app's Expo project. That works from a
  self-hosted server with no account of your own.
- **Google sign-in on the phone** redirects to `mobile://callback`. Add it to
  `ADDITIONAL_REDIRECT_URLS` in `.env`, and to the Google OAuth client's
  allowed redirect URIs, along with
  `https://<your domain>/auth/v1/callback`.
- **Without Caddy:** any reverse proxy works if it serves the web app and
  Kong on one HTTPS origin with the path split above. Kong publishes
  `${KONG_HTTP_PORT:-8000}` and the app listens on `${APP_PORT:-3000}` on the
  host. Postgres binds to `127.0.0.1` unless you set `POSTGRES_BIND`.

### OTA JS updates (HOUP-168)

The official release APK ships with `expo-updates` and fetches JS-only bundle
updates from our `production` EAS Update channel (`apps/mobile/eas.json`
`preview` build profile). This is **independent of backend selection** — an
OTA JS update only replaces the app's JavaScript bundle, and the app still
picks its Supabase backend at runtime via `GET /api/public-config` as
described above, so pushing a JS fix does not change or pin which backend a
self-hoster's phone talks to.

If you build your own APK from this repo instead of installing the official
one, your build has no updates URL to opt into: `apps/mobile/app.config.ts`
only sets `updates.url`/`owner`/`extra.eas.projectId` for the values tied to
this project's own EAS account. To opt out entirely, don't set those fields
(or point them at your own EAS project) — your binary then never checks any
update channel and only ever runs the JS bundle it was built with.

**Publishing is automatic (HOUP-270).** The `ota` job in
`.github/workflows/ci.yml` publishes to the `production` channel on every push
to `main`, with no manual `eas update` step:
- It only runs after the `check` job (typecheck + test) passes — a failing
  push publishes nothing.
- It skips merges that touch only `apps/web/**`, `supabase/**`, `.docs/**`, or
  `.github/**` — OTA only has something to deliver when `apps/mobile/**`,
  `packages/core/**`, or `packages/ui/**` changed.
- The update message embeds the commit SHA, so a published update group
  traces back to the exact commit that produced it.

**Native/dependency changes are never OTA-deliverable.** A change that adds or
upgrades a native module (or otherwise moves the Expo runtime-version
fingerprint) cannot ship through this job or through a manual `eas update` —
installed apps won't pick up a bundle built for a different fingerprint. That
kind of change needs a fresh APK build and reinstall instead.

## Backing up your data

Everything that matters lives in two places:
- The `db-data` Docker volume (all your household data) — back it up with
  `docker compose exec db pg_dump -U postgres postgres > backup.sql`, or by
  archiving the volume directly (`docker run --rm -v homeup_db-data:/data -v
  $(pwd):/backup alpine tar czf /backup/db-data.tar.gz /data`).
- The `.env` file at the repo root (your generated secrets — see "First-boot
  provisioning"). Losing this without a `db-data` backup means the data is
  unrecoverable; losing it *with* a `db-data` backup still requires
  regenerating secrets, which invalidates all existing sessions.

The `db-config` volume holds pgsodium's root key, which Vault needs to
decrypt the seeded push-notification secrets. Back it up alongside
`db-data`. If the key is lost anyway, the next `up` re-encrypts both
secrets from `.env` (the `migrate` step updates them on every run).

The `storage-data` volume holds uploaded files (photos, attachments) — back it
up the same way as `db-data` if you use file uploads.

### Encryption at rest

Rooftap doesn't encrypt your data or uploaded files itself: Postgres and the
storage service write them to the Docker volumes as they are. Anyone who gets
the disk, or a copy of a backup, can read passports, receipts and everything
else people upload. So:

- **Encrypt the disk** that holds Docker's data (`/var/lib/docker` by
  default): LUKS on Linux (most installers offer it), FileVault on a Mac,
  BitLocker on Windows. A NAS usually has an encrypted-volume option.
- **Encrypt your backups**, including the `backups/pre-migrate-*.dump` files
  `migrate` writes into the repo folder, before they leave the machine. For
  example `restic` or `borg` (both encrypt by default), or
  `gpg -c backup.sql` for a one-off file.
- **Keep `.env` out of the same unencrypted place as the backups.** It holds
  the service-role key and database password.

The hosted service's storage providers (Supabase Storage, Cloudflare R2)
encrypt at rest on their side.

## Upgrading Rooftap

```bash
git pull
./scripts/self-host-init.sh -d --build
```

`--build` matters: the `app` image is built from source, so without it the
web app stays on the old code. New migrations apply automatically on `up`
(the `migrate` service tracks what has run), and edge functions are a bind
mount, so they pick up the new code when `edge-runtime` restarts.

Before applying new migrations to an install that already has data, the
`migrate` service saves a backup of the database to
`backups/pre-migrate-<UTC time>.dump` in the repo folder and keeps the newest
five (`MIGRATE_BACKUP_KEEP` in `.env` changes that, `MIGRATE_BACKUP=off` turns
it off). If the backup fails, nothing is migrated and `migrate` exits with an
error; `docker compose logs migrate` says why. Each migration runs in one
transaction together with the row that records it, so a migration that fails
is rolled back completely: fix the cause (or pull the fix) and run the upgrade
again, and it retries from a clean slate.

The phone app updates itself as soon as we ship, so it can be newer than
your server. It asks the server which version it runs and hides features that
need a newer one; Settings > Modules lists what updating would add.

To undo an upgrade, check out the version you were running and restore the
backup taken just before it:

```bash
git checkout <the version you came from>
./scripts/restore-backup.sh backups/pre-migrate-<time>.dump
```

The script checks that the checkout matches the backup, asks you to confirm,
then deletes the database volume, rebuilds the schema from that version's
migrations and loads the backup's rows (app data, accounts and file records).
Uploaded files, `.env` and the other volumes are left alone. Anything written
after the backup was taken is lost.

## Upgrading stack images

The Supabase service images (`auth`, `rest`, `realtime`, `storage`, `kong`,
`edge-runtime`, `db`) are pinned to specific versions in `docker-compose.yml`
— no `:latest` tags, so upgrades are a deliberate, reviewable step rather than
something that happens silently on a restart. To upgrade: bump the image tag
for the service you want to update, then `docker compose pull && docker
compose up -d`. Read that service's own release notes first — `db` in
particular carries your actual schema, so treat a Postgres major-version bump
with the same care you would for any production database upgrade.

## Existing Vercel-hosted deployment — unaffected

This work doesn't change how the existing Vercel + hosted-Supabase deployment
runs; `vercel.json` and that deployment path stay as-is. The one thing that
*does* apply there too: the bypass-hardening change above means the Vercel
deployment must also set `BYPASS_USERNAME`/`BYPASS_PASSWORD` if it uses that
login path — it's no longer implicitly `admin`/a hardcoded default.

See [deployment.md](./deployment.md) for how that Vercel + hosted-Supabase
path applies migrations on merge (a CI `migrate` job, added by HOUP-334) —
unlike here, that path did not automatically apply schema changes.
