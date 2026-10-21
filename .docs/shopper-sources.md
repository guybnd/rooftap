# Shopper price sources

Shopper (HOUP-434) watches what a household wants to buy. The prices, nearby stores and shared deals it shows come from **sources**: small server-side connectors in `apps/web/src/lib/shopper/sources/`. Sources are how Shopper works in different countries. Anyone can add one for their region, and nothing else in the app changes when they do.

There are two ways to add one: a file in the repo (a pull request), or an **external source** that runs anywhere, in any language, and that a server operator points their server at without changing Rooftap at all.

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
3. Add a test that runs the shared conformance suite over a recorded response, with no network. `runSourceConformance` (in `sources/conformance.ts`) replays each fixture to every fetch the source makes, then checks the manifest and everything returned against the contract:

   ```ts
   import { runSourceConformance } from "./conformance";
   import { priceSpyNz } from "./pricespy-nz";

   it("passes the conformance suite", async () => {
     const { problems, calls } = await runSourceConformance(priceSpyNz, {
       ctx: { region: "NZ", currency: "NZD", near: { lat: -36.85, lng: 174.76 } },
       offers: { input: "sony bravia 65", body: recordedSearchResponse },
     });
     expect(problems).toEqual([]);
     expect(calls[0]).toContain("q=sony");
   });
   ```

   It also fails a source that claims a capability without a fixture to prove it, or that returns nothing from its fixture.
4. If it needs a key, add it to `.env.example` and to the runtime keys in `apps/web/src/lib/admin-keys.ts`, so an admin can set it from Settings.

## External sources (no pull request)

An external source is a small web service that answers three JSON calls. The server operator lists it in `SHOPPER_HTTP_SOURCES`, a JSON list of `{ url, token, manifest }`:

```json
[{
  "url": "https://prices.example.nz",
  "token": "a-long-random-secret",
  "manifest": {
    "id": "pricespy-nz",
    "name": "PriceSpy",
    "regions": ["NZ"],
    "capabilities": ["offers", "stores"],
    "attribution": "Prices from PriceSpy",
    "homepage": "https://pricespy.co.nz",
    "ratePerMinute": 30
  }
}]
```

`kind` defaults to `api`, and `ratePerMinute` to 30. An external source can't declare `env` keys, because its own secrets stay on its own server. A bad entry is logged and skipped, and so is an id that clashes with a built-in source. The rest still load. Use `https`, since the token travels with every call. Plain `http` is accepted only so a connector on the same private network (a Docker sidecar, say) can work.

The server sends each request as a `POST` with `Content-Type: application/json`, plus `Authorization: Bearer <token>` when a token is set. A connector implements only the calls for the capabilities it lists.

| Call | Body | Answer |
|---|---|---|
| `POST {url}/offers` | `{ "query", "region", "currency", "near" }` | `{ "offers": SourceOffer[] }` |
| `POST {url}/stores` | `{ "store", "region", "near" }` | `{ "stores": SourceStore[] }`, nearest first |
| `POST {url}/deals` | `{ "query", "region", "currency" }` | `{ "deals": SourceDeal[] }` |

`near` is `{ "lat", "lng" }`, rounded to about 1 km, or `null` when the household hasn't set a home location. The server doesn't call `/stores` without it. The shapes are the ones in `packages/core/src/shopper-sources.ts`:
- **`SourceOffer`**: `store`, `title`, `url` (https or null), `price_cents` (a positive integer), `currency`, `in_stock` (true, false or null).
- **`SourceStore`**: `name`, `lat`, `lng`, `address`, `hours`.
- **`SourceDeal`**: `title`, `url`, `price_cents`, `currency`, `posted_at` (ISO date or null).

The server checks everything that comes back against the same rules as an in-repo source, and drops anything that breaks them. A non-2xx answer counts as "didn't answer" for that check.

## Only the thing itself

Sources search by words, so a search for "LG C5" also turns up a power cable "for LG C5" and an LG fridge. Before anything is saved, the server keeps only offers that are the product (`relevantOffers` in `packages/core/src/shopper-relevance.ts`):
- a title must carry every model-like word of the search ("c5", also inside "OLED65C5PSA") and at least half of the other words;
- add-ons are dropped (cable, remote, mount, replacement, spare, "for LG C5" and similar) unless the search itself asks for one;
- a price under 30% of the matching offers' median, or under 25% of the household's target or budget, is dropped as a different product.

Shared deals pass the same title check. A source doesn't need to do any of this itself, but returning fewer, better matches is still kinder to its rate limit.

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

- The household hasn't switched it off in **Settings > Shopper**. Every applicable source starts switched on. Switching one off stops Shopper asking it for prices, stores or deals. Prices it already found stay until the next check replaces them. The choice is kept in `groups.shopper_disabled_sources` (migration `20261021050000_shopper_source_switches`).

`GET /api/shopper/sources` lists the sources that apply to the caller's household, each with `enabled`. `PUT` with `{ "id", "enabled" }` flips a source. The list screen uses it to say "prices by hand on this server" when no enabled source can search.

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
