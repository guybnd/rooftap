# Security

Do not open a public issue for a vulnerability. Report it privately with the **Report a vulnerability** button on this repository's Security tab. Include the steps to reproduce and the commit you tested.

You get an answer within a week. Fixes land upstream first and reach this repository in the next sync.

## Scope

In scope:

- the web app and the API routes (`apps/web`)
- the database migrations and row-level security (`supabase/migrations`)
- the edge functions (`supabase/functions`)
- the self-host stack (`docker-compose.yml`, `scripts/`)

Out of scope: a weakness that needs the operator to change the documented defaults of their own server. Examples are a Postgres port open to the internet, or `ALLOW_AUTH_BYPASS` on a server that the internet can reach.
