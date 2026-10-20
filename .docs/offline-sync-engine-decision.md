# Offline sync engine decision (HOUP-70)

> **TL;DR** — **Keep Legend-State v3 + `syncedSupabase`, port it to native by swapping the persistence plugin.** None of the three greenfield challengers (PowerSync, ElectricSQL, WatermelonDB) beats the cost of throwing away ~6 tickets' worth of proven write-path correctness (idempotent upsert, durable retry queue, tombstone deletes, group-scoping) for a rewrite. A working PoC (this ticket) proves the existing store factory compiles and bundles through Expo for both web (RNW) and Android with only the persist plugin, Supabase client auth-storage, and network-status glue changed — everything else is copy-paste. Android **on-device** execution is out of scope (no SDK/emulator in this sandbox, same blocker HOUP-71 hit); code-level + bundler-level verification stands in for it, documented below.

## Decision

**Legend-State v3 stays.** Path A ("swap the persistence plugin, keep the ~20 stores") is not just cheaper on paper — it is now **proven**: `spike-android-widget-poc/src/legend/` contains a working RN/Expo port of `src/lib/legend/create-group-store.ts` that:

- Typechecks (`tsc --noEmit`, using Metro's `.native.ts`/`.web.ts` platform-file convention).
- Bundles clean for **web (RNW)**: `npx expo export -p web` → `Web Bundled … (316 modules)`.
- Bundles clean for **Android's JS graph**: `npx expo export -p android` → `Android Bundled … (684 modules)`.
- Prebuilds a real native Android project (`npx expo prebuild --platform android`, the same no-SDK-required codegen check HOUP-71 used).

None of the three challengers can make an equivalent claim without first standing up new server-side infrastructure (Sync Rules/Streams, an auth proxy, or a hand-built backend) — see the scorecard below.

## Scorecard

| Criterion | **Legend-State (incumbent, native port)** | PowerSync | ElectricSQL | WatermelonDB |
|---|---|---|---|---|
| **1. Web + native, one codebase** | **Yes — proven in this PoC.** Same store factory, same collection config; only the persist plugin differs (IndexedDB web / expo-sqlite native), split via Metro's `.web.ts`/`.native.ts` convention (a runtime `Platform.OS` branch broke the web bundle — see "Web-bundling gotcha" below) | Yes, but RN Web support is explicitly **beta** | Weak — web/PGlite-first; RN via community drivers or the immature TanStack DB layer | Yes, but via **two different engines** (native SQLite/JSI vs web LokiJS/IndexedDB) — a real architectural seam |
| **2. RLS + group-scoping** | Server-side via `filter: select.eq('group_id', groupId)` + real Postgres RLS on write-back. **Spike finding:** the *local* IndexedDB cache is not group-scoped today (see below) | Server-side Sync Rules/Streams (JWT-parameterized) — a genuine authorization boundary, but a new DSL to learn and maintain per table | **No built-in enforcement** — requires a self-built Authorization Proxy/Gatekeeper; RLS-driven shapes is still an open discussion, not shipped | **No framework-level enforcement at all** — entirely on how you write your own pull/push RPCs |
| **3. Offline write correctness** | Proven end-to-end in this PoC (see "PoC evidence" below): optimistic write, durable IndexedDB-backed queue survives a simulated restart, idempotent upsert collapses retries into exactly one row | Built-in durable upload queue; conflict resolution is app-defined (typically last-write-wins) | **No built-in write path** — 4 documented DIY patterns, most only partially offline-capable, no built-in queue/idempotency | Built-in local read/write + a pull/push sync protocol, but conflict handling is still substantially your own responsibility in the push handler |
| **4. Migration cost (~20 tables)** | **Zero rewrite.** One persist-plugin swap + Supabase client auth storage + NetInfo/AppState glue — everything else (filter, create/update overrides, retry policy) copy-pastes | Moderate — declarative Sync Rules/Streams per table + one connector class; real effort, but bounded and declarative | **Highest** — hand-build the write API, an auth proxy, and conflict handling from scratch | Moderate-high — hand-build a generic pull/push pair (potentially reusable across all 20 tables), but 100% your own design/test/security surface |
| **5. Supabase auth integration** | Already works (web); native needs only a storage adapter swap (`expo-secure-store` recommended in production; the PoC uses AsyncStorage to stay dependency-light) | First-class — dashboard toggle, direct JWT/JWKS validation | None built-in — you wire your own proxy to Supabase Auth | None built-in — you wire your own RPC functions to Supabase Auth |
| **6. Ops burden** | **None new.** No extra service; Supabase (already in use) is the only backend | Hosted (free tier + $49–599+/mo tiers) **or** self-hosted Open Edition (Docker; note: uses **MongoDB internally** for bucket state even though your primary DB is Postgres) | Self-hosted (Postgres logical replication + Electric service) **or** Electric Cloud, **plus a mandatory** self-built auth proxy and write-path service | **Lowest of the three challengers** — pure client library, only "infra" is Postgres RPC functions on the existing Supabase project |
| **7. Maturity / RN fit / scale** | Already production-proven on web (~20 tables, hard-won correctness fixes FLUX-263/265/1545); RN support is the same `@legendapp/state@3.0.0-beta.47` package already pinned — **beta**, worth tracking to GA | Strong lineage (JourneyApps industrial customers pre-spinout), active 2026 releases, first-party RN+Expo; RN Web itself still beta | 10.3k stars, active, but the 2026 rebrand ("agent platform built on sync") signals Rooftap's CRUD use case is no longer the product's core focus; weakest RN story of the three | 11k+ stars, strong native large-list perf (JSI/SQLite, benchmarked to hundreds of thousands of rows), but latest release ~1 year stale and community flags maintenance pace as a real concern |

Full per-engine research detail (sources, version numbers, verdict reasoning) — PowerSync, ElectricSQL, WatermelonDB — is preserved in this ticket's history (desk-research comment) rather than duplicated here; the table above is the load-bearing summary.

**Why not the strongest challenger (PowerSync)?** It's the best of the three greenfield options, but adopting it still means: rewriting all ~20 tables' sync config into Sync Rules/Streams, standing up (or paying for) a sync service, building a connector class that re-implements the idempotent-upsert behavior FLUX-263/265 already solved, and accepting that its own RN Web support is beta — the exact same maturity risk as staying on Legend-State v3-beta, but *without* the ~6 tickets of already-paid-down correctness work. If Legend-State's RN story stalls or a specific scaling wall appears in practice, PowerSync is the recommended fallback re-evaluation, not Electric or Watermelon (see scorecard rows 2–3 for why).

## PoC evidence

Code: `spike-android-widget-poc/src/legend/` (a disposable Expo app, same one HOUP-71 used — not `apps/mobile`, since HOUP-66's monorepo hasn't landed yet).

| File | Role |
|---|---|
| `create-group-store.ts` | Line-for-line port of `src/lib/legend/create-group-store.ts` (web) — collection config, `filter: eq('group_id', groupId)`, idempotent `create`/`update` overrides (FLUX-263/265), retry policy. Only `persist.plugin` changed |
| `supabase-sync.native.ts` | `expo-sqlite` persist plugin (`@legendapp/state/persist-plugins/expo-sqlite`, already shipped in the pinned `3.0.0-beta.47` — no new dependency beyond Expo's own) + AsyncStorage-backed Supabase auth |
| `supabase-sync.web.ts` | The exact same `observablePersistIndexedDB` plugin the Next.js web app already uses — RNW ships to a real browser, so this is genuinely shared, not just "the same engine, different code" |
| `grocery-items-store.ts` | The one table (`grocery_items`) the ticket's PoC scope calls for |
| `net-glue.ts` | `useReconnectSync` ported from web: `window.online`→`NetInfo.addEventListener`, `document.visibilitychange`→`AppState`. The FLUX-1545 channel-health watchdog was deliberately **not** ported — it's a realtime-connection-quality refinement on the same two triggers, not a platform-porting concern; carry it over verbatim in `packages/core` |

**Offline write → reconnect → sync loop, and idempotency** (the ticket's core assertion) are proven **mechanically**, not by manual click-through, in `src/lib/legend/create-group-store.offline.test.ts` (web repo, run via `npx vitest run src/lib/legend`) — against the **actual production** `create-group-store.ts`/`supabase-sync.ts`/`grocery-items-store.ts`, with a fake Supabase client standing in for the network boundary and `fake-indexeddb` standing in for the browser (a real, non-mocked IndexedDB implementation). It asserts:

1. An offline write is queued (never reaches the fake "server" while offline) and visible optimistically.
2. The queued write survives a simulated app restart (`vi.resetModules()` + re-import against the same IndexedDB backing) — proving `persist.retrySync: true` really does what it claims.
3. On reconnect, the write reaches the server **exactly once** — proving the FLUX-263/265 idempotent-upsert fix holds regardless of how many retries fired while offline.

**Cross-platform bundling** (the "web (RNW) and native (Android)" half of AC3) is proven at the **code + bundler level**:
- `npx expo export -p web` and `npx expo export -p android` both succeed with the store wired into `App.tsx`.
- `npx expo prebuild --platform android` generates a real native Android project.

**Not run: on-device Android render.** This sandbox has **no Android SDK, emulator, or physical device** — the identical blocker HOUP-71 documented in `.docs/mobile-widget-spike.md`. Per that spike's own precedent, this is called out explicitly as **deferred to a real device/CI environment** rather than silently skipped: `npx expo run:android` (or an authenticated `eas build`) on a machine with the SDK, confirming the store round-trips against a real Supabase project end to end.

### Spike finding: local IndexedDB cache is not group-scoped today

The group-isolation test above surfaced a genuine, previously-latent gap: `createGroupStore`'s persist config (`{ name: indexedDbName, plugin: getIndexedDBPersist(), retrySync: true }`) sets no `indexedDB.prefixID`. Legend's IndexedDB plugin (`persist-plugins/indexeddb.js`) keys its entire table by `name` alone unless `prefixID` is set — so **two groups' stores mounted in the same session currently share one local table** and can read each other's cached rows. Only the *server* round-trip (RLS + the `group_id=eq.` filter) is actually group-scoped today; the local cache is not.

This has not surfaced in production because a session today mounts one group's stores at a time. It becomes a real risk the moment a native (or web) session holds two groups' stores concurrently — e.g. a fast group-switcher, or prefetching a second group for offline use. **Fix (one line, carry into `packages/core`):** `persist: { ..., indexedDB: { prefixID: groupId } }` (web) and the equivalent per-group key on the native persist plugin. Flagging here rather than fixing in this spike — it's an implementation task for whichever ticket parameterizes the persist plugin (HOUP-67), not a blocker to the engine decision.

### Web-bundling gotcha (for whoever builds this for real)

The first version of this PoC used a single `supabase-sync.ts` with a runtime `Platform.OS === 'web' ? indexedDBPlugin : expoSqlitePlugin` branch. `npx expo export -p web` failed: `expo-sqlite`'s own web implementation pulls in a `wa-sqlite` WASM asset that this bare Expo project's Metro config can't resolve, and a **static top-level import is resolved by the bundler regardless of the runtime branch it's used in**. Splitting into `supabase-sync.native.ts` / `supabase-sync.web.ts` (Metro's platform-extension convention) fixed it — the native-only import never enters the web bundle's module graph at all. `packages/core`'s real implementation should use this same platform-file split, not a `Platform.OS` branch, for any module that imports a native-only package.

## `packages/core` data-layer API (HOUP-67 consumes this)

Engine-agnostic in *shape* (so a future engine swap only touches this module, never a screen), and a light generalization of what `src/lib/legend/create-group-store.ts` already exposes as `useStoreHelpers`/`useReconnectSync`:

```ts
// packages/core/src/data/group-store.ts

interface SyncedRow {
  id: string;
  group_id: string;
  deleted: boolean;
}

/** One call per table, at module scope — mirrors today's `groceryItems$ = createGroupStore(...)`. */
function createGroupStore<T extends SyncedRow>(config: {
  collection: string;
  storageName: string; // today's `indexedDbName`; renamed since it's no longer IndexedDB-specific
}): (groupId: string | null | undefined) => GroupStoreHandle<T>;

interface GroupStoreHandle<T> {
  /** Reactive read — the engine-specific observable/hook is wrapped so callers never import it directly. */
  useRows(filter?: (row: T) => boolean): T[];
}

/** Write helpers — same three verbs `useStoreHelpers` already exposes today, unchanged signatures. */
function useStoreHelpers<T extends SyncedRow>(
  store: GroupStoreHandle<T>,
  currentUserId: string | null | undefined,
): {
  writeRow: (row: T) => void;
  patchRow: (id: string, patch: Partial<T>) => void;
  softDeleteRow: (id: string) => void;
};

/** Reconnect/refresh glue — NetInfo+AppState on native, online+visibilitychange on web, behind one call. */
function useReconnectSync<T extends SyncedRow>(store: GroupStoreHandle<T>): void;
```

Notes for HOUP-67's extraction:
- `storageName` replaces `indexedDbName` — same value today, but the name shouldn't imply a specific storage engine once native ships.
- `useRows` wraps the `use$(() => Object.values(store$.get() ?? {})...)` selector pattern every web page currently hand-writes — worth centralizing regardless of the engine decision, since it's the #1 place a future swap would otherwise touch every screen.
- The FLUX-1545 channel-health watchdog stays inside `useReconnectSync`'s implementation (web variant only, until an equivalent native realtime-quality signal is designed) — callers never see it.
- HOUP-67's own plan already defers moving `legend/**` into `packages/core` to a named follow-up (it needs a platform-injected environment abstraction first). Whichever ticket does that move should carry the `indexedDB.prefixID`/native-equivalent group-scoping fix from the finding above as part of the move, not as a second follow-up.

## Web-PWA (`@serwist/next`) reconciliation

No conflict, no replacement needed. `@serwist/next` owns **service-worker-level** offline (asset/route caching, install-to-home-screen) on the Next.js web app; Legend-State + `syncedSupabase` owns **data-level** offline (the actual rows, writes, and sync queue) on both web and native. They already coexist today on web — this decision doesn't add or remove either layer, and native has no service-worker equivalent to reconcile against in the first place (Expo's own asset/update story, e.g. EAS Update, is the native analogue to `@serwist/next` and is out of this ticket's scope).

## Files

- `spike-android-widget-poc/src/legend/` — the RN/Expo PoC store (create-group-store.ts, supabase-sync.native.ts, supabase-sync.web.ts, grocery-items-store.ts, net-glue.ts)
- `spike-android-widget-poc/App.tsx` — wires the PoC store in so bundling checks actually exercise it
- `spike-android-widget-poc/tsconfig.json` — `moduleSuffixes` addition so `tsc` mirrors Metro's platform-file resolution
- `src/lib/legend/create-group-store.offline.test.ts` — the offline-write/reconnect/idempotency/group-isolation proof, run against production code
- `src/lib/legend/create-group-store.ts` / `supabase-sync.ts` / `grocery-items-store.ts` — the incumbent, unmodified (this spike only reads/tests them)
