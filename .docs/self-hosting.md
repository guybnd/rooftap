# Self-hosting Rooftap

> **TL;DR** Run `./scripts/self-host-init.sh -d`. It starts Rooftap and a bundled Supabase stack on your own machine, with no cloud account and no outside sign-up. You sign in with a local account. Google sign-in, Calendar sync and AI are optional.

## Quick start

```bash
git clone <this repo> rooftap && cd rooftap
cp .env.example .env
# Optional: set NEXT_PUBLIC_MAPBOX_TOKEN (https://account.mapbox.com/access-tokens/)
# for maps, geocoding and directions. Without it, the app hides those views.
# The first run generates the secrets (POSTGRES_PASSWORD, JWT keys and so on).
# Every other setting has a working default or is optional, see .env.example.
./scripts/self-host-init.sh -d
```

Then open <http://localhost:3000> and create the owner account. You need no outside accounts.

**Always start the stack with `./scripts/self-host-init.sh`, not with `docker compose up`.** The script writes the first-boot secrets into `.env` before any container starts. A plain `docker compose up` starts every service with empty secrets. "First-boot secrets" below explains why.

## What is in the stack

One `docker-compose.yml` starts these services:

| Service | Image | What it does |
|---|---|---|
| `app` | built from the repo's `Dockerfile` | The Next.js app |
| `db` | `supabase/postgres` | Postgres, with `pg_cron` and Vault |
| `auth` | `supabase/gotrue` | Email and password sessions, and optional OAuth |
| `rest` | `postgrest/postgrest` | The REST API over Postgres |
| `realtime` | `supabase/realtime` | Live updates in the open apps |
| `storage` | `supabase/storage-api` | File storage (photos, attachments) |
| `kong` | `kong` | The API gateway for `/auth`, `/rest`, `/realtime`, `/storage` and `/functions` |
| `edge-runtime` | `supabase/edge-runtime` | The Deno edge functions in `supabase/functions/` (notifications, calendar sync) |
| `migrate` | one-shot | Applies `supabase/migrations/*.sql` to `db`, then stops |

This is the self-hosted Supabase layout that Supabase documents, cut down to the parts Rooftap uses. It has no Studio dashboard, no pg-meta, no image transforms and no Supavisor pooler. One household does not need a connection pooler.

## First-boot secrets

On the first run, `./scripts/self-host-init.sh` generates these values and writes them into `.env` at the repo root:

- `JWT_SECRET`, `ANON_KEY` and `SERVICE_ROLE_KEY`: the signing key and the API keys made from it
- `POSTGRES_PASSWORD`: the database superuser password
- `SECRET_KEY_BASE`: the Realtime session-signing secret
- `REALTIME_DB_ENC_KEY`: the Realtime encryption key (16 characters)
- `HOUSEHOLD_KEYS_SECRET`: the key that encrypts households' saved AI keys and Home Assistant tokens

**The script never generates them again.** Every session and every database request depends on `JWT_SECRET`. Every Postgres role depends on `POSTGRES_PASSWORD`, and every Realtime connection depends on the two Realtime values. New values would end every session and lock the services out of the database. The script checks each value first and keeps a value that is already set, so a restart changes nothing.

**Back up `.env`** together with the Postgres volume ("Backing up your data" below). Without `.env`, the services cannot sign in to `db` again and every session ends.

Compose cannot do this step itself. It reads the `${VAR}` values in the compose file once, before any container starts. A container that generates the values starts too late, because every other service already has the empty values. So the script writes `.env` on the host first, then runs `docker compose up` for you.

## Migrations and edge functions

The `migrate` service applies every file in `supabase/migrations/` on each start. It records what it applied, so a second run on the same data volume changes nothing. It also writes the two Vault secrets (`project_url`, `service_role_key`) that the notification triggers need ("Push notifications" below).

`edge-runtime` serves every edge function in `supabase/functions/` straight from the repo: `calendar-push`, `calendar-sync`, `main` and the `notify-*` functions. `supabase/functions/README.md` describes them. You do not run `supabase db push`, `supabase functions deploy` or any Vault SQL by hand.

## Push notifications

`public.notify_edge_function` calls the `notify-*` edge functions from database triggers and from cron. It reads the target URL and the key from Supabase Vault, not from `.env`. Postgres runs inside the `db` container, so it needs the gateway address inside the Docker network (`http://kong:8000`), not the browser address.

`scripts/apply-migrations.sh` writes both Vault rows on the first boot, after the migrations. On a later run, it finds them and does nothing. If the step fails, the `migrate` logs show a warning and name the manual SQL in `supabase/functions/README.md`. The failure never stops the stack.

## Sign-in: the first account, then closed

Registration is open until the first account exists. Then the auth server closes it (`GOTRUE_DISABLE_SIGNUP` is `true` by default in `docker-compose.yml`). The login page has no sign-up form. The stack has no mail server, so the first account is confirmed at once and signed in.

**The welcome screen.** A new install with no accounts opens a welcome screen in place of the login form. The screen asks `GET /api/setup/status`, which only says whether an account exists. It then creates the owner with `POST /api/setup/first-user`. When an account exists, the welcome page sends you to the login page, and the route answers `409`, so nobody can use it again.

**More members.** The owner adds every later account in **Settings → Users**. This works with sign-up closed, because it uses the service-role admin client, not the public sign-up endpoint.

**Open registration again.** Set `GOTRUE_DISABLE_SIGNUP=false` in `.env` and restart `auth` (`docker compose up -d auth`). The app has no switch for this on purpose: a stolen admin session cannot open registration.

**A locked-out owner.** The stack has no mailer, so there is no "forgot password" email. To reset the owner password, use the service-role key from a one-off script (`admin.auth.admin.updateUserById(ownerId, { password })`), or connect to Postgres in the `db` container. The app has no path for this on purpose: only a person with access to the host can recover the owner.

**Usernames.** The auth server needs an email address for every account. When you type a name with no `@`, the app turns it into `<username>@homeup.local` before it signs in (`packages/core/src/auth/identifier.ts`). You only see the username. A real email address also works. `@homeup.local` is never a real address.

**Google sign-in (optional).** Create your own OAuth client in Google Cloud. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, and uncomment the `GOTRUE_EXTERNAL_GOOGLE_*` lines of the `auth` service in `docker-compose.yml`. Google sign-in then works for an account that already exists. It cannot create a new account, because `GOTRUE_DISABLE_SIGNUP` also closes that path. Your client can stay in Google's "Testing" mode for a household: add each member as a test user.

**A member who wants Google sign-in.** The owner creates the account in **Settings → Users** with the member's real Google address, not a username. At sign-in, the auth server finds the account by its email, so "Continue with Google" signs the member in. Rooftap cannot link a Google identity to an existing password account yet.

**Google Calendar.** You can connect Google Calendar only while you are signed in with the same Google account. The `calendar-callback` route refuses to link a calendar to an email-and-password session.

**Dev access.** The login page has a "Dev access" option. It works only when `.env` sets both `BYPASS_USERNAME` and `BYPASS_PASSWORD`. Without them, the route answers `503`. The first sign-in creates the account `<BYPASS_USERNAME>@homeup.local` with `BYPASS_PASSWORD`. A later change to `BYPASS_PASSWORD` does not change the password of that account. The same name and password also work in the phone app's normal sign-in.

## Keys and settings in the app

**Server operators.** Some settings change the server for every household, so only a server operator can see them. Being a household owner is not enough. List the operators' emails in `SERVER_OPERATOR_EMAILS` in `.env` (comma-separated). If you leave it unset, nobody gets these panels. Only `.env` sets this list: no screen, API or database row can change it.

**API keys.** In **Settings → API keys**, an operator can enter the optional keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `SCRAPER_API_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`) with no restart. The app stores them in the service-role-only `admin_config` table and uses them from the next request. A key left empty falls back to `.env`. The panel also shows `NEXT_PUBLIC_MAPBOX_TOKEN` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, read-only, because the build puts them into the browser bundle ("Build-time settings" below).

**Test a key.** Each row has a **Test** button. It calls a free metadata endpoint of that provider and answers Valid, Invalid, No credit or Unreachable. The test reads the key in the same order as a real request: the stored value first, then `.env`. So it also finds an old stored key that hides the key you just changed in `.env`. A test runs only when you press the button.

**Parsing provider.** The same panel has a **Parsing provider** setting (OpenAI, OpenRouter, Gemini or Anthropic). It sends all AI reads (listings, receipts, recipes) to one provider. On **Default**, listings and receipts use OpenAI and recipes use Gemini.

**Edge functions read `.env` only.** The Deno functions in `edge-runtime` (`calendar-sync`, `calendar-push` and the others) do not read `admin_config`. A Google key that you set in the app works for the app's own routes, for example the token refresh in `src/lib/google-calendar.ts`. An edge function still needs the key in `.env` and in `docker-compose.yml`.

**Households' own AI keys.** A household owner can save their own Gemini, OpenAI, Anthropic or OpenRouter key in **Settings → Integrations & keys → Household AI keys**. AI reads and the assistant then use that key first, with no monthly limit. The app encrypts the key with `HOUSEHOLD_KEYS_SECRET` (AES-256-GCM) before it stores it, and it shows only the last four characters again. Without that secret, households cannot save keys. A new secret makes every saved key unreadable.

The panel shows only where a household key adds something. On a self-hosted server with `SERVER_OPERATOR_EMAILS` set, nobody sees it, because the operator manages the server's keys in **AI providers**. On a server with no operator, the panel stays, because it is then the only way to add a key in the app.

On a self-hosted server, `ROOFTAP_BILLING` is unset, so every household can use the server's key with no limit.

## Choosing which modules your server offers

Each feature (Tasks, Calendar, Groceries, Home Search and so on) is a module ([modules.md](modules.md)). By default, the server offers all of them, and each household owner turns them on or off in **Settings → Modules**.

To offer fewer, set `HOMEUP_MODULES` in `.env` to a comma-separated list of ids, for example `household,calendar,checklists,documents,groceries,recipes,costs,setup,search`. Then restart `app` and `edge-runtime`. The edge functions also read the list, so notifications skip the modules that the server does not offer. No household can turn on a module that is not on the list. The app reads the list at runtime, and the phone app gets it from `/api/public-config`, so you rebuild nothing.

## The household assistant

Turn on the **Assistant** module in **Settings → Modules**. The household then gets a chat agent. It reads tasks, the calendar, the budget, groceries, recipes and checklists, and it changes them when you agree. It also reads Home Setup and the Shopper watchlist. On a self-hosted server, it needs no paid plan and has no spending cap unless an owner sets one.

It needs a model. One of `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is enough. Gemini Flash is the cheapest default.

**Settings → Integrations & keys → AI providers** is for the operators in `SERVER_OPERATOR_EMAILS`. There you can:

- add or replace each provider's key
- add a **custom provider**: any server with OpenAI's chat API (Ollama, LM Studio, vLLM, a company gateway), with its address, an optional key and its model names
- add more model names to a provider. Rooftap marks them unverified, because it cannot check their tool calls or their price.
- choose the model for each job: assistant chats, quick asks and AI reads (receipts, recipes, listings, events)
- choose the models that households can pick in **Settings → Assistant**. A household with its own key for a provider can always pick that provider's verified models.

The app stores these settings in `admin_config` (`AI_SETTINGS`), so you need no restart. A setting left empty falls back to the environment. To keep everything on your own machine with environment settings only, run Ollama or LM Studio and set:

```
ASSISTANT_PROVIDER=compatible
ASSISTANT_BASE_URL=http://ollama:11434/v1
ASSISTANT_MODEL=llama3.1:8b
```

A local model needs tool calls to reach your data. Llama 3.1 and later, Qwen 2.5 and later, and the Mistral models have them. `ASSISTANT_MODEL_PRICES` gives the usage tracking a price for a model that Rooftap does not know. Local models count as free. Each household then chooses what the assistant can do in each module (Read, Ask first, Act) in **Settings → Assistant**.

### The assistant on Telegram

Your household can talk to the assistant on Telegram, in a private chat or in a family group. The server stores every message like any other, so the history stays on your server and also shows in the app.

1. Make a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy its token. For a group, you can also send BotFather `/setprivacy` → Disable. The bot then sees replies to it without a mention. Mentions and commands work in both cases.
2. In `.env`, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` (a long random string, for example from `openssl rand -hex 32`). `TELEGRAM_BOT_USERNAME` is optional, because the app reads it from the token.
3. Choose how updates reach the app:
   - **No public address** (most home servers): run the poller with `docker compose --profile telegram up -d`. It asks Telegram for updates from your machine and passes each one to the app on localhost. You open no ports.
   - **Public HTTPS** (a domain, or a tunnel from "Mobile access"): send Telegram to the webhook, and do not run the poller:
     ```
     curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
       -d url=https://<your-domain>/api/assistant/telegram/webhook \
       -d secret_token=$TELEGRAM_WEBHOOK_SECRET \
       -d 'allowed_updates=["message","callback_query"]'
     ```
4. Each person links their own Telegram account in **Settings → Assistant → Telegram**. **Link Telegram** gives a code to send to the bot as `/start CODE`. The bot then answers as that person, with their private items, the household's trust levels and their allowance.

In a private chat, the bot talks in the household thread until the person starts their own chat (`/new <question>`, `/chats`, `/switch <n>`, `/household`). In a group, it answers a mention, a reply or a command, always in the household thread. So add it only to groups whose members can see household answers. A change under "Ask first" comes with **Do it** and **Not now** buttons.

### The assistant and Home Assistant

The assistant can check and control your home through Home Assistant's own MCP server. Nothing extra runs in the Rooftap stack.

1. In Home Assistant, add the **Model Context Protocol Server** integration (Settings → Devices & services → Add integration). Expose to Assist the entities that the assistant can reach (Settings → Voice assistants → Expose). It sees nothing else.
2. On your Home Assistant profile page (Security tab), make a **long-lived access token**.
3. In Rooftap, an owner opens **Settings → Assistant → Home Assistant**, enters the address (for example `http://homeassistant.local:8123` or `http://192.168.1.20:8123`) and the token, and taps **Connect**. Rooftap tries the connection before it saves it.

The app encrypts the token with `HOUSEHOLD_KEYS_SECRET`, so that secret must be set. A self-hosted server can reach Home Assistant on your own network. The hosted Rooftap server connects only over public HTTPS (Nabu Casa, a Cloudflare tunnel or Tailscale Funnel) and refuses private addresses.

Owners choose one trust level for Home Assistant (Read, Ask first, Act) and can turn off single tools. Reads (`GetLiveContext`) always run. Actions such as switching a device or setting a light obey the trust level, and Rooftap cannot undo them.

## Build-time settings (`NEXT_PUBLIC_*`)

Next.js writes the `NEXT_PUBLIC_*` values into the JavaScript bundle when it builds. To change one, you rebuild the image.

This matters for `NEXT_PUBLIC_SUPABASE_URL`. The browser bundle and the app's own server code both use it. On Docker's default bridge network, a container reaches the gateway at `http://kong:8000`, but the browser on your machine reaches it at `http://localhost:8000`. One build-time value cannot hold both.

So the `app` service uses Docker's **host networking** (`network_mode: host` in `docker-compose.yml`). The container then shares the host's network, and `localhost:8000` is the same place for the browser and for the server code.

- **Linux:** this works with no extra setup.
- **Mac and Windows (Docker Desktop):** first turn on **Settings → Resources → Network → Enable host networking**. Without it, the `app` ports do not work.

A later version can inject these values at request time in place of the build. The app can then run on the bridge network like the other services.

## Mobile access

The phone app asks on first start: "Official" or "my own server". It reads `GET /api/public-config` from the server you enter. That tells it the Supabase address and the modules to use, so you need no custom app build. A phone needs two things:

- **HTTPS.** Android release builds refuse plain `http://` to any host but localhost. A LAN address like `http://192.168.1.20:3000` does not work.
- **One address that the phone can reach.** The phone sends auth, data, realtime and storage to `SUPABASE_PUBLIC_URL`. If you leave it unset, it is `http://localhost:8000`, which on a phone is the phone itself.

The compose file has four optional ways to get both. Each gives one hostname with a real certificate. It sends Supabase's API paths (`/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1`) to Kong and everything else to the web app.

| Option | Profile | You need | The phone needs |
|---|---|---|---|
| Tailscale Funnel | `tailscale-funnel` | a free Tailscale account | nothing |
| Cloudflare Tunnel | `cloudflare-tunnel` | a domain on Cloudflare | nothing |
| Public domain | `https` | a domain, ports 80 and 443 open | nothing |
| Private Tailscale | `https` | a Tailscale account | the Tailscale app |

The two tunnels open no ports on your router. The tunnel runs on the server, handles HTTPS and forwards to a small plain-HTTP Caddy on `127.0.0.1:8088` (`docker/volumes/caddy/Caddyfile.tunnel`). Both tunnels put your server on the public internet. The login page protects it, and registration closes when the owner account exists.

### With Tailscale Funnel (no domain, no open ports)

1. In the [Tailscale admin console](https://login.tailscale.com/admin), turn on HTTPS certificates (DNS page). Make sure your access controls allow Funnel. New tailnets allow it. Otherwise, add the `funnel` node attribute.
2. Create an auth key (Settings, Keys). In `.env`:

   ```bash
   TS_AUTHKEY=tskey-auth-...
   TS_HOSTNAME=rooftap
   SUPABASE_PUBLIC_URL=https://rooftap.<tailnet>.ts.net
   SITE_URL=https://rooftap.<tailnet>.ts.net
   ```

   `<tailnet>` is your tailnet's DNS name from the DNS page.
3. Run `docker compose --profile tailscale-funnel up -d`. This adds a Tailscale node named `rooftap`, separate from any Tailscale on the host. It uses the auth key only on the first start and keeps the node in the `tailscale-state` volume.

In the app, choose "my own server" and enter `https://rooftap.<tailnet>.ts.net`.

### With Cloudflare Tunnel (your domain, no open ports)

1. In the Cloudflare dashboard (Zero Trust, Networks, Tunnels), create a tunnel of type Cloudflared and copy its token.
2. Add a public hostname to the tunnel, for example `rooftap.example.com`, with service type `HTTP` and URL `127.0.0.1:8088`.
3. In `.env`:

   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   SUPABASE_PUBLIC_URL=https://rooftap.example.com
   SITE_URL=https://rooftap.example.com
   ```

4. Run `docker compose --profile cloudflare-tunnel up -d`.

In the app, choose "my own server" and enter `https://rooftap.example.com`.

### With a public domain

Point a DNS record at the host and open ports 80 and 443. In `.env`:

```bash
HOMEUP_DOMAIN=rooftap.example.com
SUPABASE_PUBLIC_URL=https://rooftap.example.com
SITE_URL=https://rooftap.example.com
```

Then run `docker compose --profile https up -d`. Caddy gets a Let's Encrypt certificate on the first start. In the app, choose "my own server" and enter `https://rooftap.example.com`.

### With Tailscale, private to your tailnet

Turn on HTTPS certificates for your tailnet (admin console, DNS page). Then set:

```bash
HOMEUP_DOMAIN=<machine>.<tailnet>.ts.net
SUPABASE_PUBLIC_URL=https://<machine>.<tailnet>.ts.net
SITE_URL=https://<machine>.<tailnet>.ts.net
```

Uncomment the `tailscaled.sock` volume on the `caddy` service, so that Caddy can get the `*.ts.net` certificate from the local Tailscale daemon. Then run `docker compose --profile https up -d`. Every phone needs the Tailscale app. If you do not want that, use Funnel.

### Installing the web app (PWA)

The `app` image is a production build, so it has the web app manifest and the offline service worker. A browser that can install web apps can add Rooftap to the home screen or the desktop. It then opens in its own window, works offline from its cache, and on Android accepts shared photos, PDFs and calendar files.

Browsers install a web app, and run its service worker, only over HTTPS. `http://localhost:3000` counts as secure on the server itself. Every other device needs the HTTPS setup above:

1. Start the `https` profile with a public domain or a Tailscale name.
2. Set `NEXT_PUBLIC_SUPABASE_URL` to the same `https://` address and rebuild with `./scripts/self-host-init.sh -d --build`. The installed app blocks an `http://` value as mixed content.
3. Open `https://<your domain>` and install it:
   - **Android (Chrome, Edge, Samsung Internet):** menu, then **Install app** or **Add to Home screen**.
   - **iPhone and iPad (Safari):** Share, then **Add to Home Screen**.
   - **Desktop (Chrome, Edge):** the install icon at the right of the address bar. Firefox on desktop cannot install web apps.

Browser push notifications are optional and need VAPID keys (`.env.example` explains them). On iPhone, they work only in the installed app, on iOS 16.4 or later.

### Notes

- **What we tested.** We ran the stack with `HOMEUP_DOMAIN=localhost` (Caddy's own local certificate authority) and the web app on the host (`next start`). Through Caddy, on one address, `/api/public-config` returned `https://localhost`, a password sign-in worked, REST and storage calls worked, realtime connected, and `http://` redirected to HTTPS. We did not test Let's Encrypt, Tailscale or a real phone.
- **The tunnel profiles.** We ran the tunnel Caddyfile against stub services. API paths reached Kong, everything else reached the app, it accepted any public host, and it passed on the tunnel's `X-Forwarded-Proto: https`. We did not run the Funnel or Cloudflare connectors.
- **The web app on other devices** also needs `NEXT_PUBLIC_SUPABASE_URL` set to the same `https://` address and a rebuild (`./scripts/self-host-init.sh -d --build`), because the build writes it into the bundle. The phone app does not need this, because it reads the value at runtime.
- **Push notifications** to the phone app go through Expo's push service (`exp.host`) under the official app's Expo project. This works from a self-hosted server with no Expo account of your own.
- **Your own phone app build.** The public repo has no `apps/mobile/google-services.json`. Without it the APK builds, but it gets no push notifications. To get push, create a Firebase project, add an Android app with your package name, and put its `google-services.json` in `apps/mobile/`. `apps/mobile/google-services.example.json` shows the shape. In the Google Cloud console, restrict the key to your package name and SHA-1 fingerprint. You also need your own Expo project. You do not need any of this for the official app.
- **Google sign-in on the phone** redirects to `mobile://callback`. Add it to `ADDITIONAL_REDIRECT_URLS` in `.env`. Also add it, and `https://<your domain>/auth/v1/callback`, to the allowed redirect URIs of your Google OAuth client.
- **Without Caddy.** Any reverse proxy works if it serves the web app and Kong on one HTTPS address with the path split above. Kong listens on `${KONG_HTTP_PORT:-8000}` and the app on `${APP_PORT:-3000}` on the host. Postgres listens on `127.0.0.1` unless you set `POSTGRES_BIND`.

### App updates

The official APK gets JavaScript updates from Rooftap's `production` EAS Update channel. An update replaces only the app's JavaScript. The app still chooses its server at runtime with `GET /api/public-config`, so an update never changes which server your phone uses.

If you build your own APK, it gets no updates. `apps/mobile/app.config.ts` sets `updates.url`, `owner` and `extra.eas.projectId` only for the official EAS project. Leave those fields unset, or point them at your own EAS project. Your build then runs only the JavaScript it was built with.

An update cannot carry a native change. A change that adds or upgrades a native module needs a new APK.

## Backing up your data

Two places hold everything that matters:

- The `db-data` Docker volume holds all household data. Back it up with `docker compose exec db pg_dump -U postgres postgres > backup.sql`, or archive the volume (`docker run --rm -v homeup_db-data:/data -v $(pwd):/backup alpine tar czf /backup/db-data.tar.gz /data`).
- The `.env` file at the repo root holds your generated secrets ("First-boot secrets"). Without `.env` and without a `db-data` backup, the data is lost. With a `db-data` backup but no `.env`, you must generate new secrets, and every session ends.

The `db-config` volume holds the pgsodium root key, which Vault needs to decrypt the push-notification secrets. Back it up with `db-data`. If you lose the key, the next start encrypts both secrets again from `.env`, because `migrate` updates them on every run.

The `storage-data` volume holds uploaded files (photos, attachments). Back it up like `db-data` if you upload files.

### Encryption at rest

Rooftap does not encrypt your data or your uploaded files itself. Postgres and the storage service write them to the Docker volumes as they are. A person with the disk, or with a copy of a backup, can read passports, receipts and every other upload. So:

- **Encrypt the disk** that holds Docker's data (`/var/lib/docker` by default): LUKS on Linux (most installers offer it), FileVault on a Mac, BitLocker on Windows. A NAS usually has an encrypted-volume option.
- **Encrypt your backups** before they leave the machine. This includes the `backups/pre-migrate-*.dump` files that `migrate` writes into the repo folder. For example, use `restic` or `borg` (both encrypt by default), or `gpg -c backup.sql` for one file.
- **Keep `.env` away from unencrypted backups.** It holds the service-role key and the database password.

## Upgrading Rooftap

```bash
git pull
./scripts/self-host-init.sh -d --build
```

You need `--build`, because the build makes the `app` image from source. Without it, the web app keeps the old code. New migrations apply on start (the `migrate` service records what it applied). The edge functions are a bind mount, so they use the new code when `edge-runtime` restarts.

Before `migrate` applies new migrations to an install with data, it saves a backup of the database to `backups/pre-migrate-<UTC time>.dump` in the repo folder. It keeps the newest five. `MIGRATE_BACKUP_KEEP` in `.env` changes the number, and `MIGRATE_BACKUP=off` turns the backup off. If the backup fails, `migrate` applies nothing and stops with an error. `docker compose logs migrate` shows why.

Each migration runs in one transaction with the row that records it. So a migration that fails rolls back completely. Fix the cause, or pull the fix, and run the upgrade again. It starts again from a clean state.

The phone app updates as soon as we ship, so it can be newer than your server. It asks the server for its version and hides the features that need a newer one. **Settings → Modules** lists what an update adds.

To undo an upgrade, check out the version you ran before and restore the backup from just before the upgrade:

```bash
git checkout <the version you came from>
./scripts/restore-backup.sh backups/pre-migrate-<time>.dump
```

The script checks that the checkout matches the backup and asks you to confirm. It then deletes the database volume, builds the schema from that version's migrations and loads the rows from the backup (app data, accounts and file records). It does not touch uploaded files, `.env` or the other volumes. You lose anything written after the backup.

## Upgrading stack images

`docker-compose.yml` pins each Supabase image (`auth`, `rest`, `realtime`, `storage`, `kong`, `edge-runtime`, `db`) to a version, with no `:latest` tag. So an image never changes on a restart. To upgrade one, change its tag, then run `docker compose pull && docker compose up -d`. Read that service's release notes first. `db` holds your schema and data, so plan a Postgres major-version upgrade as carefully as any production database upgrade.
