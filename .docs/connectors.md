# Connectors

A connector brings data from outside Rooftap into one module. It either works by itself (the server reads the outside service, or the service pushes to the server) or a person imports a file by hand. Up Bank and bank statement import (CSV) are the bundled connectors. Each connector has a panel in **Settings > Connectors**, and the panel shows only while the connector's module is on.

The apps never talk to the outside service. The connector runs on the household's server (the hosted one, or a self-hosted one). It writes rows into the module's tables, and both apps read those rows through the normal API.

## The manifest

A connector is declared next to the module whose data it fills, in `packages/core/src/modules/<module>/connectors/<id>.ts`, and listed in that module's manifest under `connectors`. The types are in `packages/core/src/connector.ts`.

```ts
export const upBankConnector = defineConnector({
  id: 'up-bank',                 // kebab-case, unique
  label: 'Up Bank',
  description: 'Reads your Up payments and balances. Rooftap never moves money.',
  iconId: 'landmark',            // a Lucide icon name
  kinds: ['pull', 'webhook'],    // any of 'pull' | 'webhook' | 'import'
  data: 'bank-transactions',     // which shared write path it uses
  source: 'up',                  // the value in its rows' source column
  keys: [{ id: 'up-token', from: 'person', label: 'Up personal access token' }],
  hosted: 'operator',            // 'everyone' | 'operator'
  regions: ['AU'],               // ISO country codes, or '*'
  serverFeature: 'connectors.up-bank',
  panel: 'up-bank',
  homepage: 'https://developer.up.com.au',
});
```

What each field means:
- `kinds`: how data arrives. `pull` means the server reads the service, for example when someone opens Costs. `webhook` means the service pushes new data to the server. `import` means a person picks a file.
- `data`: the kind of rows the connector writes. Each kind has one shared write path on the server (see below).
- `source`: the value the connector writes in the `source` column of its rows. The server uses it to remove a connector's rows together, and Costs uses it to say where a payment came from.
- `keys`: what the connector needs before it works. A `person` key is something each person pastes in the panel. A `server` key is an environment variable that the server operator sets.
- `hosted`: set `operator` when the outside service allows personal use only. Then on the hosted server only the operator's own household can use it. On a self-hosted server everyone can.
- `serverFeature`: the entry in `packages/core/src/server-features.ts` that names the migration with the connector's tables. A server that is older than that migration shows the panel with a note that the server needs an update.
- `panel`: the id of the connector's settings panel. Each app maps every panel id to its component in its `settings-registry.ts` (`CONNECTOR_PANELS`). The map is typed against the ids, so the typecheck fails when one app has no panel.

`CONNECTORS` in `packages/core/src/connectors.ts` lists every connector with its module. `connectorProblems()` checks the list, and `connectors.test.ts` fails on a bad id, a `source` or panel that two connectors share, an unknown server feature, or a description with an em dash.

## Bank feeds

Connectors with `data: 'bank-transactions'` write accounts to `bank_accounts` and payments to `bank_transactions`. Both tables are private to the server. The server applies each person's sharing choice (nothing, joint accounts only, or everything) when it reads them.

A person makes one sharing choice for all bank connectors. The server keeps it in `bank_feed_settings`, and also on the Up connection for a person who has one. `saveBankFeedSettings` in `apps/web/src/lib/up-bank.ts` writes both, so the two stay the same. An account is joint when its row has `ownership` set to `JOINT`. Up says which accounts are joint. For an imported statement, the person says it.

All bank connectors save through `apps/web/src/lib/connectors/bank-feed.ts`:
- `saveBankAccounts(admin, owner, source, rows, { prune })` saves one person's accounts. With `prune`, it removes the accounts of that source that the read no longer lists.
- `saveBankTransactions(admin, rows)` saves payments in batches. A row is keyed by `source`, person and the bank's own id, so a second read of the same payment updates it.
- `removeBankFeed(admin, userId, source)` removes everything one source saved for a person.

The shapes are `BankAccountRow` and `BankTransaction` in `packages/core/src/modules/costs/up-bank.ts`. Amounts are integer cents, and money out is negative. After a save, call `applyBankLinks` from `apps/web/src/lib/up-bank.ts`, so the household's link rules and the filing of joint payments cover the new rows.

Nothing else has to change. Costs, the Money view, the budget and the Assistant's money tools read the tables for every source.

## Adding a connector

1. Write the manifest in `packages/core/src/modules/<module>/connectors/<id>.ts` and list it in the module manifest's `connectors`.
2. Add its panel id to `ConnectorPanelId` in `packages/core/src/connector.ts`, and add its panel to `CONNECTOR_PANELS` in both apps' `settings-registry.ts`.
3. Add its API routes in `apps/web/src/app/api/`. Write through the shared path for its `data`.
4. If it needs a new table or column, add a migration and a server feature that names it. A `source` value is free text in the database, so a new bank connector needs no migration for that.
5. If it reads an outside service, write a test over a recorded response, with no network.
6. Add a What's new entry for the module.

## Rules a connector must follow

- Read only. A connector never moves money or changes anything at the outside service.
- Each person connects their own account. Tokens are encrypted on the server (`HOUSEHOLD_KEYS_SECRET`) and never go back to the apps.
- Imported data is private to the person who connected it until they choose to share it.
- Use an official API, a published feed or a file the person exports. No screen scraping.
- Respect the outside service's terms. If it allows personal use only, set `hosted: 'operator'`.
- Fail quietly. A connector that can't reach its service shows an error in its panel, and the rest of the app still works.

The bundled connectors:

| id | Module | Kinds | Needs |
|---|---|---|---|
| `up-bank` | Costs | pull, webhook | each person's Up token |
| `csv-bank` | Costs | import | nothing |

## Bank statement import

The `csv-bank` connector works with any bank that exports a CSV statement. The app reads the file on the device, with the helpers in `packages/core/src/modules/costs/bank-csv.ts`:
- `parseCsv` splits the text into cells. It accepts quoted cells, a comma, a semicolon or a tab between cells, and a byte order mark.
- `guessCsvMapping` finds the date, description and amount columns. It reads the header names when the file has a header, and the values when it does not. It accepts one signed amount column, or a debit and a credit column. It also finds a balance column.
- `guessDateOrder` reads dates day first, unless a value such as `12/31/2026` shows that the month comes first.
- `csvTransactionIds` gives each payment an id from its date, amount and description. Two identical payments on the same day get different ids. When a person imports an overlapping statement, the server finds the same ids and does not add the payments again.

The person checks what the app found, names the account and says whether it is joint. Then the app sends the payments to `POST /api/bank-import`. `GET` lists the person's imported accounts, `PUT` changes the sharing choice, and `DELETE ?account=<id>` removes one account and its payments. A statement without a balance column gives an account with `has_balance` set to false, and Costs leaves it out of the balance totals.

To make the reader understand a new bank's layout, add a test with a few rows of that bank's export to `bank-csv.test.ts`.
