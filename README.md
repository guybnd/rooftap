# Rooftap

[![License: ELv2](https://img.shields.io/badge/license-ELv2-blue.svg)](LICENSE)

Rooftap is a household management app: shared tasks and chores, groceries, recipes, a family calendar, costs and budget, loyalty cards, price tracking, and an assistant that can talk to Home Assistant. Each household switches on only the modules it uses.

This repository is everything you need to run your own Rooftap server. Your household's data stays on your machine. Rooftap is source-available under the [Elastic License 2.0](#license): free to self-host and modify, but you may not offer it to others as a hosted service.

**[Try the demo](https://guybnd.github.io/rooftap/demo/?live=1&theme=ember-night)** (runs in your browser on sample data, no account) · [Website](https://guybnd.github.io/rooftap/) · [Android APK](https://github.com/guybnd/rooftap/releases)

<p>
  <img src="apps/web/public/landing/screens/home.webp" width="190" alt="Home: today's tasks, weather and what's coming up">
  <img src="apps/web/public/landing/screens/groceries-aisles.webp" width="190" alt="Groceries sorted by aisle, with items running low">
  <img src="apps/web/public/landing/screens/costs.webp" width="190" alt="Costs: monthly spend against the plan">
  <img src="apps/web/public/landing/screens/assistant-home-assistant.webp" width="190" alt="Assistant settings with Home Assistant and Telegram connected">
</p>

## Modules

| Module | What it does |
| --- | --- |
| Tasks & Reminders | Shared to-dos, chores and reminders with due dates. |
| Calendar | Household events and everything with a date, in one view. Optional Google Calendar link: sends tasks and viewings there and shows your Google events. |
| Groceries | A shared shopping list with aisles and an item library. |
| Recipes | Your household recipes, with a cooking view. Add a recipe's ingredients to the list in one tap. |
| Checklists | Reusable lists and templates, from packing to cleaning. |
| Documents | Warranties, receipts and paperwork, filed in folders. |
| Costs & Budget | Bills, recurring costs and a monthly budget. |
| Rewards | Loyalty cards with a scannable barcode, the stores they work at, and their perks. |
| Shopper | Things you want to buy, with price tracking and a deal rating. |
| Home Setup | Rooms, purchases and the moving checklist for a new home. |
| Home Search | Listings, viewings, agents and a map while you look for a place. |
| Assistant | A household agent you can ask or talk to. It asks before it changes anything. It can use Home Assistant through HA's MCP Server integration, and you can talk to it from Telegram. Needs your own AI provider key. |
| AI assistants (MCP) | Lets an outside AI assistant, such as Claude, read and update your household through MCP. |

## Quick start

You need Docker with Docker Compose.

```bash
git clone <this repository> rooftap && cd rooftap
cp .env.example .env
./scripts/self-host-init.sh -d
```

The first run generates every secret into `.env` (back that file up), builds the app, starts the stack and applies the database migrations. Then open http://localhost:3000. The first visit creates the owner account; after that, registration is closed and the owner adds household members from **Settings → Users**.

Everything else is optional and documented in `.env.example`:
- a [Mapbox token](https://account.mapbox.com/access-tokens/) for maps, geocoding and directions;
- an OpenAI, Anthropic, Gemini or OpenRouter key for the AI parsing features;
- `HOMEUP_MODULES` to limit which modules your server offers.

The full guide covers HTTPS for the phone app, backups, upgrades and recovering a locked-out owner: **[.docs/self-hosting.md](.docs/self-hosting.md)**.

## Phone app

Use the Rooftap app from the store and point it at your server. Android release builds only talk to HTTPS servers. The easiest way with nothing to install on the phone and no open ports is the bundled Tailscale Funnel or Cloudflare Tunnel profile; a public domain with the Caddy profile works too (see "Mobile access" in the self-hosting guide).

## Web app (PWA)

The web app installs like an app on Android, iPhone, iPad and desktop: open your server in the browser and choose **Install app** (Chrome, Edge) or **Add to Home Screen** (Safari). It opens in its own window and keeps working offline. Browsers only install over HTTPS, so set up the same HTTPS front door as for the phone app, then point `NEXT_PUBLIC_SUPABASE_URL` at that `https://` address and rebuild. Step by step: "Installing the web app (PWA)" in the self-hosting guide.

## What's in the stack

`docker-compose.yml` runs Postgres, Supabase's auth, REST, realtime, storage and edge-function services behind a Kong gateway, plus the Rooftap web app (Next.js). The server needs outbound internet access for public services such as Open-Meteo weather and OpenStreetMap's Overpass API.

## Known rough edges

- No iOS app yet. iPhone and iPad use the web app (PWA).
- The Android app is not on Google Play yet. Install the APK from [Releases](https://github.com/guybnd/rooftap/releases).
- No in-app account deletion yet.
- One maintainer. Issues get read, but expect some delay.

## Development

```bash
npm ci
npm run check   # typecheck, lint and tests in every workspace
```

It's a Turborepo monorepo:
- `apps/web`: the Next.js web app and API routes
- `apps/mobile`: the Expo app
- `packages/core`: shared, platform-agnostic logic and data access
- `packages/ui`: shared React Native components
- `supabase/`: migrations and edge functions

Design and architecture notes are in [.docs/](.docs/INDEX.md).

## Contributing

This repository is a published snapshot of Rooftap's main development repository, synced on every release. Issues and pull requests are welcome here. Accepted changes are applied upstream and come back in the next sync, so a merged PR may show as closed rather than merged. [CONTRIBUTING.md](CONTRIBUTING.md) has the details.

Please report security problems privately; see [SECURITY.md](SECURITY.md).

## License

[Elastic License 2.0](LICENSE). You may run, modify and self-host Rooftap for yourself, your household or your organization. You may not offer Rooftap to others as a hosted or managed service. ELv2 is source-available, not an OSI open-source license.
