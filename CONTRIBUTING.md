# Contributing to Rooftap

Thank you for your help. Bug reports, fixes and small features are all welcome.

## How this repository works

This repository is a published snapshot of Rooftap's private development repository. Every change to the app lands there first. A sync then copies the result here as one `Sync from upstream <commit>` commit. Each sync replaces the files in this repository, so nobody merges directly here.

What that means for a pull request:

1. You open a PR against `main` here, as usual.
2. If we accept it, we apply it upstream. You stay the author, or you get a `Co-authored-by` line.
3. The next sync brings the change back here, and we close your PR with a link to that sync commit. GitHub shows it as closed, not merged. That is expected.

## Before you start

- For a change bigger than a small fix, open an issue first. Then we can agree on the approach before you spend time on it.
- Report security problems as [SECURITY.md](SECURITY.md) says, never in a public issue or PR.

## Development

```bash
npm ci
npm run check   # typecheck, lint and tests in every workspace
```

The [README](README.md) shows the layout and how to run your own server. The design notes are in [.docs/](.docs/INDEX.md).

A good pull request:

- does one thing, and its title says what changes for the user
- passes `npm run check` (CI runs the same command)
- adds or updates tests for the behaviour it changes
- adds a `whats-new/` entry if people will notice the change, or says `No user change: <why>` in its description ([whats-new/README.md](whats-new/README.md) explains the entries, which the app shows after an update)
- keeps shared logic in `packages/core` and shared components in `packages/ui`, so the change reaches web and mobile together
- changes a screen on both `apps/web` and `apps/mobile`, or says in its description why one platform waits
- adds a new migration in `supabase/migrations` for a database change, and never edits an old one

A new migration must also:

- be additive, so it is safe to apply before the code that uses it (a new table, a new nullable column, `if not exists` guards)
- grant each new public table to the Data API roles: `grant select, insert, update, delete on public.<table> to anon, authenticated, service_role;` (`apps/web/src/lib/migration-grants.test.ts` checks this)
- not manage its own transaction (no `BEGIN` or `COMMIT`)

## Adding a module

A module is a part of the app that a household can switch on or off, such as Bin night or Rewards. Open an issue first, so that we can agree on these points before you write the code:

- its privacy rule: private rows, "Just me" items, or items kept from a member
- whether the Assistant can read it and change it
- whether it shows on Home, the calendar, the agenda or search
- its section colour: any colour that no other section wears

Then start from the generator. Do not copy an old module:

```bash
npm run new-module -- plant-care --label "Plant care" --icon sprout --hue "#3A8F5C" --description "Which plants need water."
```

The module declares itself in one file, `packages/core/src/modules/<id>/manifest.ts`. The manifest holds its section, hue, tables, Assistant tools and settings, and the shared lists read it. Section 15 of [.docs/modules.md](.docs/modules.md) explains each field and what the generator writes. `npm run check` then tells you about a missing platform, logic in a screen, or a table that the Assistant cannot reach.

A new migration also needs new database types. That step needs Docker (`npx supabase db start`, then `npm run db:types`). If you cannot run Docker, say so in the PR and we generate the types when we apply it.

## Adding a price source

Shopper gets prices, stores and deals from sources. A source for your region is one file and one test, as [.docs/shopper-sources.md](.docs/shopper-sources.md) describes. A source can also run as your own small web service, with no pull request.

## Adding a connector

A connector brings outside data into a module, for example payments from a bank into Costs. A connector is a manifest next to its module, a settings panel for each app and the server routes that save its rows through a shared write path. [.docs/connectors.md](.docs/connectors.md) describes each step.

## License

Rooftap uses the [Elastic License 2.0](LICENSE). When you submit a contribution, you agree that it uses the same license, and you confirm that you have the right to submit it.
