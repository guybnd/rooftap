# What's new entries

Each file here is one change people would notice. The app bundles them, and
the first time someone opens Rooftap with entries they haven't seen, it shows
them in a sheet (grouped by release when they skipped several, filtered to
their household's modules). Settings keeps the full list: About & updates on
the phone, What's new on the web.

A PR that changes `apps/web/src`, `apps/mobile/src` or `packages/*/src` adds
one entry, or says `No user change: <why>` in its description (or carries the
`no-user-change` label). CI's `whats-new` job enforces it.

## The file

`whats-new/YYYY-MM-DD-short-slug.md`, dated the day you write it:

```markdown
---
title: Shopper watches prices for you
module: shopper
kind: feature
link: /shopper
---
Add things you want to buy and Shopper keeps the cheapest price across shops, with a price history and a deal rating.
```

| Field | | |
| --- | --- | --- |
| `title` | required | At most 60 characters. Sentence case, says what you can do now. |
| `module` | required | A section or module id: `home`, or the `id` in a module manifest under `packages/core/src/modules/` (`groceries`, `shopper`, `household`), or `app` for app-wide changes. An entry for a module that's off never shows. |
| `kind` | required | `feature` (something new), `improvement` (something better), `fix` (something that was broken). Fixes fold into one "And 4 smaller fixes" row. |
| body | required | One or two sentences, at most 220 characters. |
| `link` | optional | An app route (`/shopper`) the row's "Show me" opens. Must exist on web or mobile. |
| `platforms` | optional | `web` or `mobile` when it only shipped on one. |
| `server` | optional | A `server-features.ts` id, so self-hosters on an older server don't see it. |
| `spotlight` | optional | `true` for a big launch (a new module): it gets a full-screen card before the sheet. Features only, and rarely. |

Run `node scripts/whats-new.mjs check` to validate. `npm install`, core's
typecheck and tests, and the web build regenerate
`packages/core/src/whats-new.generated.ts` (gitignored) from these files.

## Writing one

Write for the person using the app, not for the developer. Hearth's copy
rules apply: no emoji, no em-dashes, plain words.

Good:

- **Hold the + to ask the Assistant.** Holding the + opens a chat that grows out of it.
- **A tap on a grocery row no longer opens the editor.** Tap the price to change it, or hold the row for everything else.

Not like this:

- **Refactor GroceryRow press handlers.** (A developer's view. If nothing changes for people, it's `No user change:`.)
- **Fixed bug #412.** (Says nothing to someone who never saw the bug.)

When cutting a release, `node scripts/whats-new.mjs changelog` prints the
entries since the last one as CHANGELOG lines.
