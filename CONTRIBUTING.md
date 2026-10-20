# Contributing to Rooftap

Thanks for helping. Bug reports, fixes and small features are all welcome.

## How this repository works

This repository is a published snapshot of Rooftap's private development repository. Every change to the app lands there first, and a sync copies the result here as a single `Sync from upstream <commit>` commit. Each sync replaces this repository's files, so nothing is ever merged directly here.

What that means for a pull request:

1. You open a PR against `main` here, as usual.
2. If it's accepted, it's applied upstream with you kept as the author (or credited with a `Co-authored-by` line).
3. The next sync brings it back here, and your PR is closed with a link to that sync commit. It shows as closed, not merged. That's expected.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue or PR.

## Development

```bash
npm ci
npm run check   # typecheck, lint and tests in every workspace
```

The layout and how to run your own server are in the [README](README.md); design notes are in [.docs/](.docs/INDEX.md).

A good pull request:

- does one thing, with a title that says what changes for the user;
- passes `npm run check` (CI runs the same command);
- adds or updates tests for behaviour it changes;
- keeps shared, platform-agnostic logic in `packages/core` rather than duplicating it in `apps/web` and `apps/mobile`;
- adds a new migration in `supabase/migrations` for any database change, never an edit to an existing one.

## License

Rooftap is under the [Elastic License 2.0](LICENSE). By submitting a contribution you agree that it's licensed under the same terms, and that you have the right to submit it.
