# Production deploy path (Vercel + hosted Supabase)

This covers the cloud-hosted deployment: the existing Vercel + hosted-Supabase
setup, not the self-hosted Docker Compose stack (`.docs/self-hosting.md`).

## What fires on a merge to `main`

Three things start independently the instant a PR merges to `main`:

1. **Vercel** deploys `apps/web` through its own GitHub integration. This runs
   outside GitHub Actions entirely — nothing in `.github/workflows/ci.yml` can
   gate, delay, or block it.
2. **`migrate`** (`.github/workflows/ci.yml`) runs `supabase db push` against
   the hosted project. It has no `needs:`, so it starts as soon as the push
   event fires, in parallel with Vercel's build — gating it on `check` would
   guarantee Vercel wins the race against schema, which is the failure this
   job exists to close (HOUP-334). Safe because migrations in this repo are
   additive by convention: schema ahead of code is a no-op, code ahead of
   schema is the bug this job prevents. Two back-to-back merges to `main`
   each get their own workflow run (the concurrency group is keyed by
   `run_id` on push events) and each starts `migrate` immediately — they
   neither cancel nor queue behind one another. Their `db push` calls are
   serialized only at the job level, by `migrate`'s own `migrate-production`
   concurrency group, so the second merge's schema still lands within
   seconds, not behind the first run's `check`/`ota`.
3. **`ota`** publishes the mobile OTA update, after both `check` and
   `migrate` pass and only when the merge touches mobile-shipped code. A
   failed migration blocks the OTA publish rather than shipping mobile code
   ahead of schema.

4. **`functions`** deploys the edge functions (`supabase/functions/`), after
   both `check` and `migrate` pass and only when the merge touches
   `supabase/functions/` (HOUP-339). It deploys every function directory
   except `_shared` and `main` (the self-hosted router), and each function
   keeps the `verify_jwt` setting it already has on the project. To redeploy
   without a commit, dispatch the CI workflow on `main`. It uses the same
   `SUPABASE_ACCESS_TOKEN` secret as `migrate`.

## Two secrets this job needs

`migrate` requires two repository secrets, both set on 2026-10-18. To
rotate either one, generate the new value and overwrite the secret:

```bash
# Supabase Dashboard -> Account -> Access Tokens -> generate a token (value starts `sbp_`)
gh secret set SUPABASE_ACCESS_TOKEN --repo guybnd/Rooftap

# Project ikcflyhizhfdmvztsxjw -> Settings -> Database -> Database password
# (reset it there if unknown)
gh secret set SUPABASE_DB_PASSWORD --repo guybnd/Rooftap
```

The project ref (`ikcflyhizhfdmvztsxjw`) itself is not a secret — it's
already public in `NEXT_PUBLIC_SUPABASE_URL` and is committed in
`supabase/config.toml`.

## Auditing production against the migration set (runbook)

Run this whenever you need to confirm the hosted project's schema history
actually matches `supabase/migrations/` — for example before trusting
`migrate` for the first time, or after any manual intervention. Requires
Docker running locally and `supabase link`'s prompts answered with production
credentials; this is operator work, not something an unattended CI or agent
session should attempt.

```bash
supabase link --project-ref ikcflyhizhfdmvztsxjw
supabase migration list --linked            # expect Local/Remote aligned
supabase db push --linked --dry-run         # expect: nothing to apply
supabase db diff --linked --schema public   # empty => prod schema matches the migration set
```

- **Diff empty and dry-run clean** — nothing to repair.
- **Diff non-empty** — it names a version recorded as applied whose SQL did
  not take effect. Do not blanket-repair: `db push` cannot re-run a migration
  whose history row already exists, so close the gap for the named objects
  with idempotent `add column if not exists` / `create table if not exists`
  SQL run directly against production.
- A history row is not proof a migration's SQL took effect. Confirm
  user-facing columns directly, e.g.:
  ```sql
  select column_name from information_schema.columns
  where table_name = 'user_settings'
    and column_name in (
      'grocery_sort_mode', 'home_hero_countdown',
      'checklists_completed_to_bottom', 'checklists_collapse_completed',
      'checklists_default_sort'
    );
  ```

`supabase/config.toml` is committed for exactly this runbook (`db diff
--linked`'s shadow-DB settings) and for CI's `db push` — it describes local
dev and CLI behavior only, **not** production's actual auth/API/storage
config. Never run `supabase config push`; it would overwrite production
settings with this file's local-dev defaults.

## Pausing the `migrate` job

Any migration that rewrites history (a squash, a manual `migration repair`,
anything other than a normal additive `CREATE`/`ALTER`) must pause `migrate`
first, land its own change, then re-enable it. To pause:

- Replace the `migrate` job's `if:` condition with `if: false` on a prep PR
  (do not simply comment the condition out — that deletes the
  `github.ref == 'refs/heads/main'` guard along with it, and `migrate` would
  then also run on `pull_request` events, pushing a feature branch's
  migrations to production), merge that, do the history-rewriting work, then
  revert; or
- Disable the whole `CI` workflow from the GitHub Actions UI temporarily.

Either way `ota` pauses too, since it needs `migrate`: a skipped `migrate`
skips the OTA publish. Mobile changes merged during the pause go out with
the next merge that touches mobile code after `migrate` is re-enabled (each
OTA bundles all of `main`), or with a manual `eas update`.

HOUP-16 (squashing 97 migrations into a single baseline schema) is a known
future consumer of this procedure.

## `migrate` failed: local migration sorts before the remote history

```
Found local migration files to be inserted before the last migration on remote database
```

This means a local migration file's timestamp sorts earlier than the last
version already recorded in the hosted project's history table — typically
because two same-day migrations (`20260911000001`, `…0002`, `…0003`-style
names) were authored in one order but merged to `main` in the other. `migrate`
deliberately does **not** pass `--include-all` and fails the job rather than
applying the file out of its authored order — an unattended job holding
production credentials should stop and be looked at rather than silently
reordering history.

To unblock: an operator runs `supabase db push --include-all` by hand against
production (after confirming what's being applied and in what order), then
re-drives the `migrate` job via `workflow_dispatch` on `main` so CI's history
reflects the real outcome.

See `CLAUDE.md`'s migration-authoring rule for how to mostly avoid this
condition at the source: use a timestamp later than every file already on
`main`, re-checked at merge time.

## Public self-host mirror

`.github/workflows/public-mirror.yml` publishes this repo's current tree, never its history, to a separate public repo for self-hosters. It runs after each green CI run on `main`, or by hand.

- `scripts/public-mirror.sh` builds the snapshot: tracked files minus `.public-mirror/exclude.txt`, plus `.public-mirror/overlay/` (the public README, SECURITY.md and a check-only `ci.yml`). It refuses to publish anything credential-shaped. Preview it with `./scripts/public-mirror.sh /tmp/homeup-public`.
- A new private-only file (agent config, a hosted-only script) needs a line in `exclude.txt`, or it goes public on the next sync.
- Setup: repo variable `PUBLIC_MIRROR_REPO` (owner/name) and secret `PUBLIC_MIRROR_TOKEN` (fine-grained, Contents read/write on that repo only). Until the variable is set, the job is skipped.

## Related

- [self-hosting.md](./self-hosting.md) — the self-hosted Docker Compose path,
  where migrations and edge functions are already fully automatic.
- HOUP-339 — edge functions deploy from CI too, through the `functions` job.
- HOUP-340 — PR-time migration validation, applying
  `supabase/migrations/*.sql` from scratch against a throwaway Postgres
  service container.
