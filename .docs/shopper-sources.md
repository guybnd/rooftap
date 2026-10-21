# Shopper price sources

Shopper (HOUP-434) watches what a household wants to buy. The prices, nearby stores and shared deals it shows come from **sources**: small server-side connectors in `apps/web/src/lib/shopper/sources/`. Sources are how Shopper works in different countries. Anyone can add one for their region, and nothing else in the app changes when they do.

The app never talks to a source. A source runs on the household's server (the hosted one, or a self-hosted one). It writes offers and daily price snapshots into `shopper_offers` and `shopper_price_snapshots`, and both apps read those through normal sync. A server with no sources still works: people add prices by hand, and the history, deal rating and alerts all work from those.

## The contract

The shapes live in `packages/core/src/shopper-sources.ts`, and the server interface is in `apps/web/src/lib/shopper/sources/types.ts`.

```ts
export const mySource: ShopperSource = {
  manifest: {
    id: 'pricespy-nz',            // kebab-case, unique, never "manual"
    name: 'PriceSpy',
    regions: ['NZ'],              // ISO country codes, or '*'
    capabilities: ['offers'],     // any of 'offers' | 'stores' | 'deals'
    kind: 'api',                  // 'api' | 'feed' | 'page'
    env: ['PRICESPY_API_KEY'],    // server keys it needs; it is skipped while any is missing
    attribution: 'Prices from PriceSpy',
    homepage: 'https://pricespy.co.nz',
    ratePerMinute: 30,
  },
  async searchOffers(query, ctx) { /* SourceOffer[] */ },
  // nearbyStores(storeName, ctx) for 'stores', deals(query, ctx) for 'deals'
};
```

What each capability means:
- `offers`: what a product costs at which store, for a search query. Return `SourceOffer`s in the household's currency, with the price in integer cents.
- `stores`: branches of a named store near `ctx.near`, nearest first. Shopper uses these to show distance on each offer.
- `deals`: community or retailer deals that match a query, shown under "Deals people shared".

`ctx` carries the household's `region`, `currency` and rough location (`near`, rounded to about 1 km). It also carries the source's resolved `keys`, and a `fetch` that applies the source's rate limit, a timeout and Rooftap's user agent. Always use `ctx.fetch`, not the global one.

## Adding a source

1. Add one file to `apps/web/src/lib/shopper/sources/` that exports the source.
2. Add it to `SHOPPER_SOURCES` in `index.ts`.
3. Add a block to `sources.test.ts` that replays a recorded response through `ctx.fetch`, with no network, and passes the result through `checkSourceOffers`. The registry test there also checks the manifest.
4. If it needs a key, add it to `.env.example` and to the runtime keys in `apps/web/src/lib/admin-keys.ts`, so an admin can set it from Settings.

## Rules a source must follow

`checkSourceOffers` enforces the first group of rules. Reviewers check the rest.

- Prices are positive integer cents in `ctx.currency`. Skip an offer you can't price, rather than guessing.
- Links are `https` and clean, with no tracking or affiliate parameters (`cleanOfferUrl` strips the common ones). Rooftap does not earn from links.
- Every source has an honest `attribution`, which shows under the prices it supplied.
- Use an official API or a published feed where one exists. A `page` source, which reads a public web page, must respect the site's robots.txt and terms, and keep `ratePerMinute` low.
- Send no personal data. A query is the item's search words. Location is only the rounded `near`, and only to sources that need it.
- Fail quietly. Throw, or return `[]`, and the lookup reports the source as "didn't answer" while the other sources still count.

## Which sources run

For each lookup, the server uses every source that meets all of these:
- Its `regions` include the household's region, or it is `'*'`.
- Every key in `env` is set.
- It is not named in `SHOPPER_SOURCES_DISABLED`, a comma-separated list of ids.

`GET /api/shopper/sources` lists the sources that apply to the caller's household. The list screen uses it to say "prices by hand on this server" when nothing can search.

The bundled sources:

| id | Region | Gives | Needs |
|---|---|---|---|
| `serpapi-google-shopping` | any | offers | `SERPAPI_API_KEY` |
| `osm-stores` | any | nearby stores (OpenStreetMap) | nothing |
| `ozbargain` | AU | deals | nothing |

## The daily price check

`GET /api/shopper/refresh` re-checks watched items that haven't been checked for 20 hours, up to 40 per run, for households that have Shopper switched on. It needs `Authorization: Bearer $CRON_SECRET`.

- **Hosted (Vercel):** `apps/web/vercel.json` schedules it daily at 19:00 UTC, and Vercel Cron sends the secret. Set `CRON_SECRET` in the project's environment.
- **Self-hosted:** call it from any scheduler, for example:
  `0 5 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-server/api/shopper/refresh`

Opening an item that is more than 6 hours stale also checks it straight away, so the cron job only keeps history filling in between visits.
