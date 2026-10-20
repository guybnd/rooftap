# Security

Please don't open a public issue for a vulnerability. Report it privately through GitHub's **Report a vulnerability** button on this repository's Security tab, with steps to reproduce and the version (the commit) you tested.

You'll get an acknowledgement within a week. Fixes land upstream first and reach this repository in the next sync.

## Scope

In scope: the web app and API routes (`apps/web`), the database migrations and row-level security (`supabase/migrations`), the edge functions (`supabase/functions`), and the self-host stack (`docker-compose.yml`, `scripts/`).

Out of scope: weaknesses that need an operator to misconfigure their own server against the documented defaults, for example publishing Postgres to the internet or setting `ALLOW_AUTH_BYPASS` on an internet-reachable instance.
