# Android home-screen widget feasibility (HOUP-71)

> Spike conclusion: **feasible.** A real Android App Widget, built with the
> `react-native-android-widget` config plugin, renders from offline-cached
> data and materializes correctly through Expo's standard `prebuild` step —
> the same step EAS Build runs server-side. iOS WidgetKit is a separate,
> deferred build (needs a Mac); its design is captured below so it slots in
> without touching the Android data contract.

> **Shipped (HOUP-106):** the real widget now lives in `apps/mobile` — see
> "Real implementation (HOUP-106)" below. This spike's AsyncStorage stand-in
> is superseded; everything else on this page (the library choice, the
> `updatePeriodMillis`/`requestWidgetUpdate` refresh strategy, the EAS Build
> gotchas) still describes the shipped shape.

PoC code lives in `spike-android-widget-poc/` at the repo root — a disposable,
standalone Expo app (SDK 57), kept for reference only. It is **not** part of
`apps/mobile` (HOUP-66).

## Real implementation (HOUP-106)

The spike's `AsyncStorage`-backed cache (`spike-android-widget-poc/src/cache.ts`)
is superseded by a versioned snapshot in the app's real offline store:

- **Snapshot key/shape:** `homeup:widget:todaysTasks:v1` in the app's existing
  `HomeUp.db` (expo-sqlite `SQLiteStorage`, `getItemSync`/`setItemSync` — no
  new dependency, no `@react-native-async-storage/async-storage`). Contract
  (`packages/core/src/widget-snapshot.ts`): `{ version: 1, updatedAt, items: [{ id, title, done, due_date, due_time, priority, assignedToMe, assigned }] }`.
  Raw `due_date`/`done` are stored, not precomputed labels, so the widget
  computes "today"/"2d overdue" and the overdue flag at render time.
- **Where the code lives:**
  - `packages/core/src/widget-snapshot.ts` — the contract + `buildWidgetSnapshotItems()`, a pure mapper from `buildHeroItems()`'s `HeroItem[]` to the snapshot shape.
  - `packages/core/src/widget-colors.ts` — `oklchToHex()`, resolving THEME_TOKENS' oklch values to the `#rrggbb` hex `react-native-android-widget`'s RemoteViews wrapper requires (it has no oklch or CSS-var support, unlike `packages/ui`'s NativeWind pipeline or a browser).
  - `apps/mobile/src/widgets/TasksWidget.tsx` — the widget UI (Hearth widget-safe subset: one lede, teal identity ring, danger/amber/success small-dose hues, relative dates, no raw ISO). **Deviation:** RemoteViews (via this library) exposes no opacity or text-decoration style props, so the done-row treatment is color-only (muted-foreground) rather than "55% opacity + strikethrough".
  - `apps/mobile/src/widgets/widgetTaskHandler.ts` — the headless task (read-only render; `WIDGET_CLICK` resolves via the widget/row's own `OPEN_URI` clickAction, not a handler branch).
  - `apps/mobile/src/widgets/widget-snapshot.ts` — read/write of the snapshot key, via its **own** `SQLiteStorage('HomeUp.db')` handle (independent of `src/lib/legend/environment.ts`'s StoreEnvironment seam — the headless task can fire before `_layout.tsx` ever mounts, so that seam's `configureStoreEnvironment()` side effect isn't guaranteed to have run).
  - `apps/mobile/src/widgets/use-widget-sync.ts` — the write side, mounted once in `src/app/_layout.tsx`; observes `householdTasks$(groupId)` and debounces a snapshot write + `requestWidgetUpdate()` on change.
- **Scope:** read-only render, tap-opens-app (`/tasks`, via the app's `mobile://` scheme). Toggle-from-widget is **HOUP-110**. iOS WidgetKit is **HOUP-108** (unchanged from this spike's design below).
- **`android.package`:** `com.homeup.mobile` (`apps/mobile/app.config.ts`) — required for `expo prebuild`/EAS Build, didn't exist before this ticket.

## Chosen approach: `react-native-android-widget` (library), not a hand-written config plugin

| | `react-native-android-widget` | Hand-written config plugin |
|---|---|---|
| Native code to own | None — library ships the `AppWidgetProvider`, `RemoteViews` renderer, and Expo config plugin | `AppWidgetProvider` + `RemoteViews` XML + config plugin, all hand-maintained |
| Widget UI | JSX-like (`FlexWidget`/`TextWidget`/`ListWidget`/`IconWidget`) compiled to `RemoteViews` | Hand-authored XML layouts |
| Update plumbing | `registerWidgetTaskHandler` headless JS task, `requestWidgetUpdate` API | Must build the JS↔native bridge yourself |
| Maintenance cost | Low — one more dependency to track | High — new native surface for the team to own long-term |
| Currency (checked 2026-07-31) | v0.21.0, published 2026-07-11, peer dep `expo >=54.0.0` (we're on 57) — active | N/A |

Recommendation: **use the library.** It removes the highest-risk native code
(the `AppWidgetProvider`/`RemoteViews` glue) from Rooftap's own maintenance
surface, and its config plugin is exactly what proved out in this spike.

## What was verified, and how

Environment available in this session: Node 20 + network + `eas-cli` via
`npx`. **No Android SDK, no Java/emulator, and no Expo account credentials**
were available — so two things could not be run directly and are called out
as the spike's documented blocker rather than silently skipped:

| Claim | Verified how |
|---|---|
| Widget renders from cached data only, no network call | Code review: `widgetTaskHandler` (`spike-android-widget-poc/src/widgetTaskHandler.ts`) only calls `readCachedTasks()`/`toggleCachedTask()`, both pure `AsyncStorage` reads — no `fetch`/network import anywhere in the widget render path |
| Config plugin wires a real `AppWidgetProvider` | Ran `npx expo prebuild --platform android` (no SDK required — prebuild only codegens the native project, it doesn't compile it). Confirmed generated: `android/app/src/main/java/.../widget/TodaysTasks.java` extending `RNWidgetProvider`, the `<receiver>` entry in `AndroidManifest.xml` with `APPWIDGET_UPDATE` + a custom `WIDGET_CLICK` action, `res/xml/widgetprovider_todaystasks.xml` with our exact `minWidth`/`minHeight`/`updatePeriodMillis` values, and the preview drawable + description string resources |
| EAS Build compatibility | **Verified (2026-07-31):** authenticated cloud build `ca623270` (profile `preview`, project `@guybnd/spike-android-widget-poc`) reached FINISHED with an installable APK — the config plugin applied cleanly in EAS's server-side prebuild. Upload gotchas for the monorepo: EAS archives the whole git repo by default (trips on the `.agents` skills symlink on Windows — worked around with `EAS_NO_VCS=1` + `EAS_PROJECT_ROOT`; `apps/mobile` should use a proper `.easignore`), and EAS re-resolves npm deps from scratch, which ERESOLVEs on `@legendapp/state`'s stale `expo-sqlite@^15` peerOptional range without this project's `.npmrc` (`legacy-peer-deps=true`) |
| Actual home-screen render on a device/emulator | **Verified (2026-07-31, physical device):** widget pinned and rendering seeded cache data on an OPPO CPH2747 (ColorOS) home screen, with no reachable backend (all sync fetches failing against the placeholder host — render is purely cache-fed). Required bumping `expo-sqlite` 15.2.14 → ~57.0.1 first: the v15 native module crashes SDK 57 at module-registry init (`ClassNotFoundException: expo.modules.kotlin.types.AnyTypeProvider`), which had made the app exit on launch and the widget render empty |

## Data sharing

Uses **`AsyncStorage`**, which on Android is backed by **SharedPreferences**
— this is the ticket's "SharedPreferences" candidate, not a third option.
`react-native-android-widget`'s headless JS task (`widgetTaskHandler`) runs
in the same app process/JS runtime as the main app, so both read/write the
identical `AsyncStorage` keys (`Rooftap:cachedTasks:v1` in the PoC) with no
extra native bridging code. When HOUP-70 lands its offline store, the real
implementation swaps `readCachedTasks()`'s body for a read of whatever
HOUP-70 settles on (SQLite or otherwise) — the widget component and task
handler's shape don't change.

## Refresh strategy

Two independent paths, both exercised in the PoC:

1. **Periodic — `updatePeriodMillis`.** Set in the widget's config-plugin
   entry (`app.config.ts`); Android fires `WIDGET_UPDATE` on this schedule.
   **Confirmed floor: ~30 minutes**, regardless of a lower configured value —
   this is an Android platform limit, not a library one. Not suitable for
   near-real-time data.
2. **On-demand — `requestWidgetUpdate`.** Called from the foreground app
   (`App.tsx`'s "Seed cache + push widget update" button in the PoC) the
   instant the app has fresh data. This is the path that should fire whenever
   Rooftap's sync engine finishes a refresh while the app is open.
3. **Background push (not exercised in the PoC, documented only).** The
   library also exposes a native `RNWidgetJsCommunication#requestWidgetUpdate`
   static method callable from a `BroadcastReceiver`/`AlarmManager`/push
   handler, for updating the widget while the app is fully closed. Relevant
   if Rooftap adds a push-triggered background sync later.

Real-world latency: **near-immediate while the app is open** (path 2),
**up to ~30 minutes stale** otherwise (path 1) unless path 3 is built out.

## Offline

Confirmed by code review (see verification table above): the render path
never imports a network client; `WIDGET_ADDED`/`WIDGET_UPDATE`/`WIDGET_CLICK`
all resolve purely from `AsyncStorage`. No live fetch is possible from the
widget's own code path.

## iOS — deferred, design only (needs a Mac)

Not built here. Documented plan so it slots in later:

- **Target:** WidgetKit extension, added via `expo-apple-targets` (or an
  equivalent hand-written config plugin) — same "config plugin generates a
  native target at prebuild time" shape as the Android path above.
- **Data sharing:** an **App Group** shared container (`UserDefaults` scoped
  to the group, or a shared file/SQLite in the group's container) — the iOS
  equivalent of Android's SharedPreferences-via-AsyncStorage. No direct
  `AsyncStorage` access from a WidgetKit extension; the main app must write
  into the App Group container explicitly.
- **Refresh:** `WidgetKit`'s `TimelineProvider` + `WidgetCenter.reloadTimelines`
  (the on-demand-push equivalent of `requestWidgetUpdate`). iOS timeline
  budgets are stricter than Android's floor and vary by widget family/OS
  version — needs its own latency measurement once buildable.
- **Shared contract:** keep the *shape* of cached data (the `CachedTask`-like
  read result) identical across platforms, so the widget UI logic — not the
  storage plumbing — is what's shared conceptually between Android and iOS.
- **Blocked on:** a Mac + Xcode + Apple Developer account, none of which
  exist in this environment. No further work possible until available.

## Files

- `spike-android-widget-poc/app.config.ts` — widget config-plugin registration
- `spike-android-widget-poc/src/widgets/TasksWidget.tsx` — widget UI (`FlexWidget`/`TextWidget`)
- `spike-android-widget-poc/src/widgetTaskHandler.ts` — headless update/click handler
- `spike-android-widget-poc/src/cache.ts` — `AsyncStorage`-backed cache read/write (HOUP-70 stand-in)
- `spike-android-widget-poc/App.tsx` — seeds the cache and demonstrates the on-demand refresh push
- `spike-android-widget-poc/eas.json` — preview build profile (untested — see blocker above)
