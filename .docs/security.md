# Security model for self-hosters

> **TL;DR** Your server keeps your data in your own Postgres, and row-level security limits each person to their own household. Rooftap sends no telemetry. The main risks are an exposed server before you create the first account, a stolen `.env`, and backups that are not encrypted.

This page tells you what Rooftap protects, what it trusts, and what you must do yourself. To report a vulnerability, use the **Report a vulnerability** button on the Security tab of the repository. Do not open a public issue.

## What runs where

| Part | Holds | Reachable from |
|---|---|---|
| `db` (Postgres) | All household data, accounts, keys | `127.0.0.1:5432` on the host only, unless you set `POSTGRES_BIND` |
| `kong` (API gateway) | Nothing. It routes auth, data, realtime, storage and functions. | Every interface on `KONG_HTTP_PORT` (8000) |
| `app` (web app and API) | Nothing. It reads `.env` and the database. | Every interface on `APP_PORT` (3000), because it uses host networking |
| `storage` | Uploaded files, in the `storage-data` volume | Through Kong only |
| `.env` | The JWT secret, the service-role key, the database password, `HOUSEHOLD_KEYS_SECRET` | The host file system |

The browser and the phone app get the anon key. The anon key is public by design. It gives no access without a signed-in session, because row-level security checks every row.

## Who can see what

- **A visitor with no account** sees the login page and the public config (`/api/public-config`). Registration is closed after the first account.
- **A household member** reads and changes the rows of their own household. Postgres enforces this with row-level security on every table in the `public` schema. A private task, event, grocery item or card is visible only to the person who owns it.
- **A household owner** also invites people, removes members and changes household settings. An invitation needs the invited person to accept it. An owner cannot add a person to a household directly.
- **A server operator** is a person whose email is in `SERVER_OPERATOR_EMAILS`. Only operators see the server-wide panels (API keys, AI providers, parsing provider). Only `.env` sets this list.
- **The service role** bypasses row-level security. Only the `app` container, the `migrate` job and the edge functions hold this key.

Tables that hold secrets or server state (`admin_config`, `household_ai_keys`, `personal_access_tokens`, `oauth_tokens`, `google_calendar_connections`, `assistant_home_assistant` and others) have row-level security on and no client policies. Only the server can read them.

## Secrets at rest

| Secret | How Rooftap stores it |
|---|---|
| Account passwords | The auth server (GoTrue) stores a bcrypt hash. |
| Bot API keys and MCP sign-in tokens | A SHA-256 hash. The full key shows once. |
| Household AI keys, Home Assistant tokens | AES-256-GCM, with a key from `HOUSEHOLD_KEYS_SECRET` |
| Operator API keys (`admin_config`) | Plain text, readable by the service role only |
| Google Calendar refresh tokens | Plain text, readable by the service role only |

A person with a copy of the database and of `.env` can read every secret above except the hashes. Treat both as one secret. [Self-hosting](self-hosting.md) has the backup and encryption-at-rest steps.

## Outbound connections

Rooftap sends no analytics, no crash reports and no usage data to anyone. The server connects to a third party only for a feature that needs it:

| Feature | Service | When |
|---|---|---|
| Weather, event forecast | Open-Meteo | The Home screen and events with a place |
| Nearby shops and stops | OpenStreetMap Overpass | Home Search and Shopper store lookups |
| Maps, geocoding, directions | Mapbox | Only if you set `NEXT_PUBLIC_MAPBOX_TOKEN` |
| AI reads and the assistant | The provider you configure | Only with a key |
| Listing pages | The listing site, or ScraperAPI if you set its key | When a person imports a listing |
| Price checks | SerpAPI, OzBargain, your own HTTP sources | Only with Shopper on and a source configured |
| Push to Android | Expo push service, then Firebase Cloud Messaging | Each notification. The title and body pass through both. |
| Google Calendar, Telegram, Home Assistant | That service | Only if you connect it |

The browser also loads the PDF.js worker from `unpkg.com` when a person reads a PDF in the web app.

## The phone app

The official Android app sends your household data only to the server you pick on the sign-in screen. It also registers with the Expo push service to get a push token. It keeps the session in the Android Keystore through `expo-secure-store`. It gets JavaScript updates over the air from the Rooftap project on Expo, so you trust that update channel when you install the official APK. If you do not want that, build the APK yourself from this repository.

## What you must do

1. Create your account right after the first start. Until the first account exists, any person who can reach port 3000 can create the owner account.
2. Keep ports 3000 and 8000 off the internet. Use the `https`, `tailscale-funnel` or `cloudflare-tunnel` profile for remote access. Each one gives one HTTPS address.
3. Keep `ALLOW_AUTH_BYPASS` empty. It exists for local tests only.
4. Back up `.env` and the `db-data` volume, and encrypt the backups.
5. Update Rooftap when a release lists a security fix. `migrate` applies the database changes on the next start.
6. If you open registration again (`GOTRUE_DISABLE_SIGNUP=false`), know that the stack has no mail server. The auth server then accepts any email without a check.

## Known limits

- The stack confirms new accounts without email, because it has no mail server.
- Edge functions load their libraries from `esm.sh` and `jsr.io` when the container starts.
- Rooftap does not encrypt the database or the uploaded files itself. Use disk encryption on the host.
