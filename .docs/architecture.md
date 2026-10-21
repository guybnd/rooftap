# Architecture

> **TL;DR** Rooftap is a Turborepo monorepo. A Next.js app serves the web UI and the API. An Expo app serves Android, and iOS later. Both apps share their logic and data layer through `packages/core`, and Supabase holds the data.

## The parts

| Path | What it is |
|---|---|
| `apps/web` | Next.js. The web app (also installable as a PWA), the API routes that both apps call, and the landing page. Code that needs server secrets lives only here. |
| `apps/mobile` | Expo (React Native). Screens are in `src/app/(tabs)/<section>/`, section components in `src/features/<section>/`. |
| `packages/core` | Types, business logic, the Supabase data layer, the local-first stores and the module registry. It has no browser, Next.js or Node imports, so both apps can use it. A lint step checks this. |
| `packages/ui` | Shared React Native components (NativeWind): the list row, swipe actions, sheets, haptics and the theme. |
| `packages/config` | Shared TypeScript and ESLint settings. |
| `supabase/migrations` | The database schema, one SQL file per change. |
| `supabase/functions` | Edge functions: Google Calendar sync and the scheduled notifications (due tasks, leave-by times, upcoming events). |

## Data

Every row belongs to a household (a `group`). Postgres row-level security limits each user to the households they belong to.

The apps are local-first. Each section reads from a Legend-State store in `packages/core`. The store keeps a copy on the device, writes changes there first, and syncs them to Supabase when the device is online. Supabase Realtime pushes other members' changes to the open apps.

## Modules

A household switches each feature on or off (Groceries, Costs, Assistant and so on). The registry is `packages/core/src/modules.ts`. A switched-off module leaves no trace in navigation, search, notifications or sync. [modules.md](./modules.md) has the details.

## Server features

- `/api/mcp` is an MCP server. An outside AI client can read and change household data with a personal key or by signing in (OAuth).
- `/api/assistant` runs the in-app Assistant. It calls the AI provider the server operator or the household picks, and it asks before it changes anything. It can talk to Home Assistant through Home Assistant's own MCP Server integration, and to Telegram.
- `/api/public-config` tells the apps which modules and which schema version the server has, so a newer app can hide features an older server cannot serve.

## Checks

`npm run check` runs typecheck, tests and lint in every workspace. CI runs the same command on every pull request.
