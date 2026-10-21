# Rooftap — Documentation Index

| File | Description |
|------|-------------|
| [architecture.md](./architecture.md) | Tech stack, folder conventions, key decisions |
| [database-schema.md](./database-schema.md) | Supabase table definitions |
| [design/hearth.md](./design/hearth.md) | Style guide: the Hearth design language (hierarchy, color, type, line items, motion, haptics) |
| [self-hosting.md](./self-hosting.md) | Running Rooftap on your own machine: `docker compose up`, first-boot secrets, local auth, backups |
| [deployment.md](./deployment.md) | Production deploy path (Vercel + hosted Supabase): what fires on a merge to `main`, the `migrate` CI job and its secrets, the production schema audit runbook, pausing `migrate` for history-rewriting migrations |
| [r2-storage.md](./r2-storage.md) | Documents on Cloudflare R2: how files are routed between R2 and Supabase Storage, one-time setup (bucket, CORS, token, Vercel env), the copy script for existing files |
| [mobile-widget-spike.md](./mobile-widget-spike.md) | HOUP-71 spike findings: Android App Widget feasibility (chosen approach, data-sharing/refresh design), iOS WidgetKit deferred plan |
| [offline-sync-engine-decision.md](./offline-sync-engine-decision.md) | HOUP-70 spike: offline sync engine decision (keep Legend-State, port to native), scorecard vs PowerSync/ElectricSQL/WatermelonDB, PoC evidence, `packages/core` data-layer API |
| [shopper-sources.md](./shopper-sources.md) | Shopper price sources: the source contract, adding a regional connector, the rules a source must follow, the daily price check |
| [modules.md](./modules.md) | Modules: per-household feature switching (module list, `group_modules`, the one predicate, "no trace" surfaces, Phase 1 plan) |
