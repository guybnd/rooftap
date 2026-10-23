# Modules: households choose their features

> **TL;DR.** Every Rooftap feature becomes a **module** that a household can switch on or off. All modules ship inside the one app (web, Android, iOS). A module that is off leaves **no trace**: no nav entry, no capture option, no hub tile, no search hit, no notification, no settings panel, no MCP tool, and its data does not sync. Data is kept, so switching a module back on restores everything. Self-hosted servers choose which modules they offer, and the store app shows only those. This note fixes the module list, the rules, and the first phase of work (switching only, no code moves).

Status: proposed, 2026-10-18. Background and effort estimate: `analysis/backlog-and-modularity.md` in the project files.

---

## 1. Goals and non-goals

**Goals**
- A household turns off what it doesn't use, and the app then feels like it was built without that feature.
- Users can see and control which features are on, in Settings and during first-run setup.
- Modules work on their own and add extra features when a partner module is also on (for example, Recipes can add ingredients to the shopping list only when Groceries is on).
- One store app for everyone. A self-hosted server decides which modules it offers, and that works the same on Android and iPhone.

**Non-goals (for now)**
- Smaller app downloads. All module code ships in every build; app size is not a goal.
- Moving code into per-module packages. That is a later phase, decided after this one ships.
- Third-party code running inside the app. Community extensions, when they come, start out of process (API, MCP, webhooks).
- Custom app builds for self-hosters.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Platform** | Always on, not a module: auth, households and members, Settings shell, Home hub frame, capture "+" frame, search frame, comments, notifications plumbing, offline sync engine, Hearth, `packages/ui`. |
| **Module** | A feature a household can switch on or off. Usually one section, but integrations without a section (MCP, Google Calendar) are modules too. |
| **Available** | The server offers the module (`HOMEUP_MODULES`). |
| **Enabled** | Available, switched on for this household, and its hard requirements are enabled too. |
| **Hidden** | A per-person nav preference (`user_settings.hidden_sections`, already shipped). Hiding only removes the nav entry for that person; it does not disable anything. |

## 3. The module list

Module ids reuse the existing section ids so `hidden_sections`, `section_order`, `default_section` and `last_used_section` keep working unchanged.

| id | Name | Default for new households | Requires | Enhances (soft) |
|---|---|---|---|---|
| `household` | Tasks & Reminders | **On** | | `checklists`, `calendar` |
| `calendar` | Calendar | **On** | | `household`, `search`, `costs` |
| `checklists` | Checklists | **On** | | `household` |
| `documents` | Documents | **On** | | `costs`, `setup`, `groceries` |
| `groceries` | Groceries & Item Library | Off | | `costs`, `recipes` |
| `recipes` | Recipes | Off | | `groceries` |
| `costs` | Costs & Budget | Off | | `setup`, `groceries`, `search` |
| `setup` | Home Setup & Moving | Off | | `search`, `costs` |
| `search` | Home Search (listings, agents, map, appointments, scoring) | Off | | `calendar`, `setup` |
| `google-calendar` | Google Calendar sync | Off | `calendar` | `household` |
| `shopper` | Shopper (watchlist, price history, deal rating) | Off | | `household`, `costs` |
| `rewards` | Rewards (loyalty cards and memberships, their partner stores and perks, store lookup) | Off | | `groceries` |
| `assistant` | Assistant (quick asks, chats, the household thread; asks before changing anything) | Off | | `household`, `calendar`, `costs`, `groceries` |
| `money-insights` | Money insights (the "Worth a look" card on Costs: price rises, subscriptions, plans ending, spending against its usual). Shows only on Costs, so it locks nothing | **On** | | `costs`, `shopper`, `household` |
| `mcp` | MCP / agent access | Off | | all |

`home` (the hub) and `profile` (Settings) are platform, not modules.

**Requires** is a hard dependency: the module can't be enabled without it, and the required module can't be switched off while a dependant is on (the toggle explains why). **Enhances** is soft: the feature that crosses the two modules appears only when both are enabled, and disappears quietly otherwise.

Known soft features to gate (each must check both modules):
- Recipes → Groceries: "add ingredients to list".
- Groceries → Costs: a finished shopping session creates a cost line.
- Checklists ↔ Tasks: attach a checklist to a task; checklist panels on the Tasks screen and hero.
- Costs → Setup, Home Search: "From your other sections" suggestions.
- Documents → Costs, Setup, Groceries: document links on those items.
- Calendar → Tasks, Home Search, Google Calendar: tasks, appointments and pulled events on the calendar.
- Calendar → Costs: an event's ticket cost kept as a Going out line in the Budget (`calendar.budget`).
- Setup → Home Search: the chosen apartment as the home being set up.
- Rewards ↔ Groceries: both show the household's `loyalty_cards` (the table syncs while either is on). Groceries' rewards sheet works with Rewards off; Rewards adds schemes, partner stores, perks and "Just me" cards.
- Shopper → Tasks, Costs: "Plan to buy" writes a to-do (`shopper.tasks`) and a planned purchase cost (`shopper.costs`).
- Assistant → Tasks, Calendar, Costs, Groceries: the assistant only gets tools for modules that are on (the same gating as `/api/mcp`), so switching one off removes it from what the assistant can read or change.

## 4. Data model

```sql
create table public.group_modules (
  group_id   uuid not null references public.groups(id) on delete cascade,
  module_id  text not null,
  enabled    boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (group_id, module_id)
);
-- RLS: any member of the group can read; only the group's owner can insert or update.
```

- **No row means the module's default** from the registry. New modules can therefore ship without a data migration.
- **Existing households** get a seeding migration that writes `enabled = true` for every module that exists today, so nothing disappears on upgrade. Only new households start from the defaults (and the onboarding picker). Google Calendar and MCP became modules later (step 7) and got their own seeding migration, `20261018080000_seed_integration_modules.sql`.
- `module_id` is free text, not an enum or CHECK constraint, so adding a module never needs a schema change.
- Both platforms load the rows with the rest of the household in `fetchGroupData()`, cache them in the cold-boot snapshot (so a switched-off module stays hidden offline and on launch), and refetch on a realtime change. Flipping a switch needs a connection; it applies optimistically and rolls back if the write fails.

## 5. Server availability

- New runtime env var `HOMEUP_MODULES`: a comma-separated list of module ids. Unset means every module.
- `/api/public-config` (already called by the mobile server picker) adds `modules: string[]`. The app caches it with the rest of the server config.
- Modules the server doesn't offer never appear anywhere, including the Modules screen.
- API routes and MCP tools for an unavailable or disabled module return 404.

## 6. The one predicate

Following the `isMovingActive` precedent (one predicate every moving affordance gates on, so the platforms can't drift), all gating goes through one core function and one hook:

```ts
// packages/core/src/modules.ts (module ids equal section ids, so no sectionId field)
export type ModuleId = 'household' | 'calendar' | 'checklists' | 'documents' | 'groceries'
  | 'recipes' | 'costs' | 'setup' | 'search' | 'google-calendar' | 'mcp';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  description: string;          // one line for the Modules screen
  iconId: string;               // lucide name, resolved per platform like sections
  sectionId?: string;           // the nav section it owns, if any
  defaultEnabled: boolean;
  requires?: ModuleId[];
  enhances?: ModuleId[];
}

export const MODULES: ModuleDef[];

/** Pure: available ∩ (row ?? default), then drop anything whose `requires` is not enabled. */
export function resolveEnabledModules(input: {
  available: ModuleId[] | null;               // null = all
  rows: { module_id: string; enabled: boolean }[];
}): Set<ModuleId>;

// packages/core/src/modules-store.ts: a process-wide store each platform's DataCacheProvider feeds
export function useModules(): {
  isEnabled(id: ModuleId): boolean;
  /** A named cross-module feature (module-features.ts) is on: every module it needs is on. */
  feature(id: ModuleFeatureId): boolean;
  enabled: Set<ModuleId>;
};

// packages/core/src/module-features.ts
export const MODULE_FEATURES: Record<ModuleFeatureId, { modules: ModuleId[]; what: string }>;
export function isFeatureEnabled(id: ModuleFeatureId, enabled: ReadonlySet<string>): boolean;
```

Every cross-module feature (anything one module shows, links to or writes in another, and any module content on the hub, capture or share) is a named entry in `MODULE_FEATURES`, and its surfaces gate on `feature(id)`. Code outside React (the checklist toggle, a shopping trip's cost line) reads `getEnabledModules()` and calls `isFeatureEnabled`. Server code (API routes, MCP, edge functions) calls `resolveEnabledModules` with the group's rows. Nothing checks module state any other way.

## 7. What "no trace" covers

When a module is off, all of these must hide it. Each is one of the gating PRs in section 10.

| Surface | Web | Mobile |
|---|---|---|
| Section switcher, sidebar, tab bar | `section-switcher.tsx`, `app-sidebar.tsx` | `components/nav/primary-tab-bar.tsx` |
| Direct navigation to a route | middleware or layout guard redirects to `/home` | route layout guard redirects to `/home` |
| Default and last-used section | fall back to `/home` | same |
| Home hub tiles and hero modules | `app/home/section-tiles.tsx`, `hero-modules.tsx` | `features/home`, `app/home/index.tsx` |
| Capture "+" sheet and share target | `components/capture/capture-sheet.tsx`, `share-destination-picker.tsx`, `app/share-target` | `components/capture/capture-sheet.tsx`, `+native-intent.ts` |
| Global search | `core/hooks/use-global-search-index.ts` (skip disabled sections' rows) | same hook |
| Calendar sources | `app/calendar` | `app/calendar` |
| Settings panels | `app/settings/[key]` and the settings index | `app/settings/index.tsx`, `features/settings/panels` |
| Notifications | edge functions `notify-*` send only while the task's owning module is on (`_shared/modules.ts`) | same |
| Android widget | | `widgets/` drops the sections of switched-off modules; with Tasks off it shows bill and document reminders only |
| MCP | `/api/mcp` returns 404 when `mcp` is off; tools register only for enabled modules (`MCP_TOOLS` in core's `mcp-tools.ts`), and bill and document reminders follow their owner in the task tools; the panel hides with `mcp` off and its tools list follows | same panel and list |
| Google Calendar | `/api/calendar/*` return 404 when `google-calendar` is off, and an import also needs its target (Tasks or Home Search); the calendar overlay, viewing suggestions, the setup panel and the "pulled events in to-do list" toggle hide (`calendar.google-events`, `search.google-suggestions`, `hub.calendar-events`). `calendar-push` sends only items whose module is on, and its reconcile pass removes the rest from Google; `calendar-sync` pulls only for members with Google Calendar on in one of their households | same |
| Module API routes | `parse-listing` (Home Search), `parse-receipt` (Groceries) and `parse-recipe` (Recipes) return 404 when their module is off (`apps/web/src/lib/server-modules.ts`) | same routes |
| Data sync | `LegendSyncBootstrap` activates only the stores of modules that are on and starts a module's stores when it is switched on; the hub, capture, the offline page, share target and the overdue badge open a switched-off module's stores with no group id (`syncedGroupId`, `store-modules.ts`) | the hub, capture, the widget sync and the overdue badge do the same (mobile has no bootstrap; stores start where they are read) |
| Offline page | `app/~offline` | |
| Cross-module features | every soft feature checks `feature(id)` (`module-features.ts`) | same |

**Switching off never deletes data.** Rows stay in the database, untouched. Links from an enabled module's items to a disabled module's items stay stored but don't render (for example, a cost line still exists, its "from Groceries" portal chip does not show).

### Cross-module touchpoints (code audit, 2026-10-18)

The tricky cases are features that **write into another module's tables**, because the rows they create keep doing things after the target is switched off. Inside the app, every one of these is now gated on a named feature, on both platforms. The rule: a switched-off target gets no new rows, but rows a feature already created keep syncing (updates and removals), so the target is right when it comes back.

| From → into | What it writes | When the target is off |
|---|---|---|
| Costs → Tasks | `cost-reminder:` household_tasks | the reminder is still written and still notifies (section 9); its "from bill" link and the bill's "Open reminder" link hide (`tasks.from-cost`). With Tasks off its notification and hub row open `/costs` (`task-modules.ts`) |
| Documents → Tasks | `doc-reminder:` household_tasks | same (`tasks.from-document`) |
| Checklists ↔ Tasks | scheduling a checklist writes its linked task; completing syncs it | no new linked task; an existing one still follows the list's date, title, completion and removal. The checklist chip, panel and picker hide (`tasks.checklists`) |
| Checklists → Costs | `log_costs` checklists write purchase cost lines | checking logs no new cost line; unchecking still removes the one an item logged. The "log costs" option hides (`costs.from-checklists`) |
| Groceries → Costs | a shopping session writes a `grocery_estimate` cost line | no new cost line; a trip's existing line keeps its total, or goes at $0. The trip panel's cost copy hides (`costs.from-groceries`) |
| Shopper → Tasks, Costs | "Plan to buy" writes a household task and a one-off purchase cost (`linked_section: 'shopper'`) | Plan to buy offers only what is on; with both off the item page offers Mark bought and an alert instead (`shopper.tasks`, `shopper.costs`) |
| Recipes → Groceries | "Add missing" writes grocery items | have and need, "Add missing" and the recipe chip on grocery items hide (`recipes.groceries`) |
| Calendar → Tasks, Search | the calendar creates tasks and viewings; Google import writes either | the add chooser, Google import buttons and viewing suggestions offer only what is on (`calendar.tasks`, `calendar.viewings`) |
| Capture and share | categories on mobile share and web capture | each category needs the features it writes through (`CAPTURE_CATEGORY_FEATURES` in documents.ts; an invoice needs Costs and Documents). A share nothing can take says so instead of landing on Home |

Places that **read or link** across modules are gated the same way: calendar aggregation, hub agenda sources and summary-hero modules (`hub.*`, `HERO_MODULE_FEATURES` in hero.ts; a saved hero toggle is kept, so it returns with the module), the hero checklist meter, portal chips, document link chips (`visibleDocumentLinks`), the legacy bill and receipt files in the documents list, hub tile and search (`listUnifiedDocuments`' `legacy` flags), and the Costs suggestions from the chosen apartment and Home Setup.

Some things stay because they belong to the module that is on:
- A scanned recipe's "View original photo". The scan stores it in the documents table even with Documents off, but it is the recipe's own photo. With Documents on, its chip on the document opens the recipe.
- A bill's own attachments on web (legacy `cost_documents`, including mirrored grocery receipts) with Documents off. Only the documents-store files linked to the bill hide.
- The grocery trip panel with Costs off.

**Which module owns a task** (`task-modules.ts`, section 9): bill and document reminders belong to Costs and Documents, everything else to Tasks. A task exists for a household only while its owner is on, so a bill reminder leaves the Tasks list, the calendar, the hub and notifications when Costs is off. With Tasks off, reminders stay on the hub and in the widget and keep notifying; tapping one opens `/costs` or `/documents`. The notify-* edge functions apply the same rules through a Deno twin (`supabase/functions/_shared/module-rules.ts`) that a core test checks against core for every module combination.

**Data sync** (step 8): `STORE_MODULES` in `store-modules.ts` maps each synced table to the modules whose data it holds (household tasks to Tasks, Costs and Documents, for reminders), and a table syncs while one of them is on. A switched-off module's unsent offline writes wait until it is back on. Write paths that cross into another module's table (a checklist removing the cost line it logged) still open that store, so the write lands and the store syncs for the rest of that session. Switching a module off mid-session stops every read of its stores at once; a store that already started keeps its realtime channel until the next launch.

**Outside the app UI**, notifications and the Android widget follow modules (step 6), and so do MCP, Google Calendar push and pull, and the module API routes (step 7). Switching a module off doesn't push anything to Google by itself: its items leave Google at their next change or at the six-hourly reconcile. Events already pulled stay stored, and show again when Google Calendar comes back on.

Ownership questions the code raises:
- **Reminders** created by Costs and Documents are stored as tasks but belong to the module that created them (decided, section 9).
- **Moving tasks** (`generateMovingTasks`, gated on the move-in date by `isMovingActive`) are household tasks, separate from Setup's moving checklist of rooms and purchases. With Tasks off they vanish even while Setup is on.
- **Viewings** live in Home Search but appear on the calendar and are labelled "Calendar" in search.
- **The chosen apartment** is set from Home Search but feeds platform features (weather, home address) and the Costs rent suggestion.

### Testing

Every gating PR ships table-driven tests that turn each module off in turn and assert the rest is unchanged, rather than hand-picked cases. In place:
- `modules-store.test.ts`: unknown, loaded and server-limited states through the real hook; switch applies at once, rolls back when refused, survives off-then-Undo.
- `use-global-search-index.test.ts`: turning each module off removes only its own results; everything off finds nothing.
- `modules.test.ts`: every module nav link maps back to its module (the route guard never bounces an enabled module), platform links map to none, switching one off drops only its section.
- `module-routes.test.ts` (web and mobile): every top-level route is classified as a module's or platform, so a new screen can't ship without an owner for the route guard.
- `module-features.test.ts`: turning each module off disables exactly the features that list it.
- Per-surface matrices, each module off in turn: hub agenda and hero modules (`hero.test.ts`, web `summary-hero.test.ts`, mobile `hero-modules.test.ts`), calendar copy and suggestions (`calendar-sources.test.ts`), document links, capture categories and the legacy merge (`documents.test.ts`), Costs suggestions (`costs.test.ts`), checklist copy (`checklists.test.ts`), mobile share routing (`share-intent-routing.test.ts`).
- Write paths: a shopping trip with Costs off writes no cost line (`grocery-sessions.test.ts`); a checklist toggle with Tasks or Costs off skips the task sync or the cost line (`use-checklist-toggle.test.tsx`).
- Onboarding picker: `modules.test.ts` covers who sees it and the Google Calendar tick; `modules-store.test.ts` covers the save (a row per offered module, rolled back when refused) and `useModulePicker`; web `module-picker.test.tsx` renders it with the defaults ticked and checks Continue, Skip and a refused save.
- Data sync: `store-modules.test.ts` checks every synced table is mapped and that each module off stops only the tables nothing else uses; web `sync-status.test.tsx` checks the bootstrap skips switched-off modules and starts a module's stores when it comes on.
- Server: the MCP endpoint answers 404 with `mcp` off and registers only enabled modules' tools (`api/mcp/route.settings.test.ts`), and its task tools drop reminders whose owner is off (`route.isolation.test.ts`); `server-modules.test.ts` covers the shared route guard and `parse-receipt/route.test.ts` one route through it. Notifications and Google Calendar push are covered by `task-modules.test.ts`, which checks the edge functions' rules against core.
- Smoke pass: web `app/module-links.test.tsx` renders the app shell and the home hub with data in every module, follows every link and button one tap deep, and checks that none leads (via `getModuleIdForPath`, or a `/settings/<module>` link) into a switched-off module, with the base modules, Tasks alone and everything off. With everything on it must reach each module the surface links, so the crawl can't pass by finding nothing. Mobile has no component test runner, so its surfaces rely on the shared core gates and their tests.

## 8. User experience

**Settings → Modules** (new entry in the Settings index on both platforms):
- One `ListGroup` of rows, one row per available module: identity icon, name, one-line description, and a toggle as the trailing control (line-item anatomy, Hearth §6; one card per list, H4).
- The toggle applies immediately with no Save button (M4). Turning a module off shows the standard undo toast instead of a confirm dialog, because nothing is lost.
- Only the household owner (`group_members.role = 'owner'`) can change toggles. Members see the same list read-only, with a caption saying who manages it, and keep their own per-person "hide from my nav" preference in the existing Navigation settings.
- A required module's toggle is locked while a dependant is on, with a caption that names the dependant ("Google Calendar sync uses this").
- Copy follows Hearth: sentence case, no em-dashes, no emoji.

**Onboarding:** after a new household is created, one screen lists the modules with the defaults pre-ticked. The user can change them now or later in Settings. Skipping keeps the defaults.

How it works (step 9): a household that has never chosen has no `group_modules` row, because existing households were seeded with rows and any switch writes one (`needsModulePicker` in `modules.ts`). Its owner gets the picker as a full-screen step once the household has loaded: web `components/module-picker.tsx`, mounted in the app shell, and mobile `components/module-picker.tsx`, an overlay in the root layout so a failed save's toast still shows. It waits while the person has a pending invitation, since they may join that household instead of the one created at signup. Continue writes a row for every offered module with the ticks; Skip, Escape on web and Android back write the defaults. Either way the household then has rows, so the picker never comes back. Ticking Google Calendar also ticks Calendar, and Calendar stays locked while Google Calendar is ticked, the same lock as Settings (`withModuleChoice`). A failed Continue reopens the picker with the ticks kept and a toast; a failed Skip stays hidden for the session and asks again on the next launch.

## 9. Decisions recorded

- App size is not a goal; all modules ship in the app (Guy, 2026-10-18).
- No custom app builds for self-hosters. Self-hosters choose modules on the server (Guy, 2026-10-18).
- Module state is per household, toggled by the owner. Per-person hiding stays as it is.
- Existing households keep everything on after the upgrade.
- Default-on base set: Tasks, Calendar, Checklists, Documents. Everything else is opt-in for new households.
- Google Calendar and MCP are modules too, off for new households. Existing households keep them on (step 7).
- Bill and document reminders belong to Costs and Documents, not Tasks. With Tasks off they keep notifying and open the bill or document instead of `/tasks` (Guy, 2026-10-18).

## 10. Phase 1 delivery plan

Each step is its own PR, ships on both platforms in the same PR (monorepo parity contract), and leaves the app working.

1. **Registry and switch.** `packages/core/src/modules.ts` and `modules-store.ts` (registry, `resolveEnabledModules`, `useModules`), the `group_modules` migration with RLS and the seeding of existing households, `HOMEUP_MODULES` plus `/api/public-config`, and gating of the nav, route guards and default/last-used section. Unit tests for `resolveEnabledModules`.
2. **Settings → Modules screen**, web and mobile.
3. **Capture sheet and share target.**
4. **Home hub tiles and hero modules.**
5. **Global search and calendar sources**, plus the cross-module soft features in section 3.
6. **Notifications and the Android widget.**
7. **MCP, Google Calendar and module API routes.** Tag each entry in `MCP_TOOLS` with its module; gate the endpoint and tool registration. Calendar push and pull skip tasks and viewings whose module is off, and module API routes return 404.
8. **Data sync.** Don't activate stores for disabled modules; activate on enable without a reload.
9. **Onboarding module picker.**

Status: steps 1 and 2 shipped together in PR #295. That PR also hid a switched-off module from the capture launcher, global search and the home hub tiles by treating it as hidden in the existing per-person `hidden_sections` checks. Steps 3 to 5 shipped together in PR #298: the named feature gate (`module-features.ts`) and every in-app touchpoint in section 7 on both platforms. Step 6 shipped in PR #299: notifications, the widget, and which module owns a task (`task-modules.ts`) on the hub, Tasks, the calendar and the overdue badges. Since PR #301, CI deploys the edge functions on merge (deployment.md). Step 7 shipped in PR #308: MCP, Google Calendar push and pull, and the module API routes, with Google Calendar and MCP as modules of their own. Step 8 shipped in PR #311: switched-off modules' tables stop syncing. Step 9 shipped in PR #313: the first-run module picker. Phase 1 is complete.

After step 9, a household that switches a module off sees no trace of it anywhere. Phase 2 (moving each module into its own package with formal contribution points) is decided after this ships.

## 11. Open questions

- Should members be able to propose a module change for the owner to approve, or is owner-only enough? (Default: owner-only.)
- Should the hub suggest switching a module on when it would help (for example "Track this bill? Turn on Costs")? (Default: no suggestions in Phase 1.)

## 12. Servers older than the app

The store app follows `main` through OTA updates, but a self-hosted server only changes when its owner pulls and rebuilds. So the app can be newer than its server and call a table or route that server doesn't have.

- `/api/public-config` reports `schemaVersion`: the newest file in `supabase/migrations/` the server was built from (`apps/web/next.config.ts` bakes it in). Servers from before this field count as the 1.0.0 baseline (`SCHEMA_BASELINE`).
- `packages/core/src/server-features.ts` lists every app feature newer than the baseline with the migration it needs. Surfaces gate on `useModules().server(id)`. A whole new module sets `minSchema` on its `ModuleDef` instead, and drops out of `offered` exactly like a module the server doesn't offer, so section 7's rules apply unchanged.
- Settings > Modules shows one line naming what updating the server would add (`useModules().serverUpdateAdds`).
- Until the app has heard from the server, everything counts as supported, so the official server never flashes features away on a cold start.
- `apps/web/src/lib/server-features.test.ts` fails if a minimum names a migration that doesn't exist.


## 13. Where module code lives

Each module's shared logic is in its own folder, `packages/core/src/modules/<id>/`, named by its id in `modules.ts`. For example, `modules/costs/` holds the cost lines, the month view and the bank feed, and `modules/money-insights/` holds the insights card and the Assistant's money notes. Code that several modules use stays in `packages/core/src/`: the types, the data layer and the synced stores, the module registry, money formatting, and the surfaces that put modules together (Home, search, the widget). Both apps still import everything from `@homeup/core`, so a move inside core changes no app code.

`npm run lint` in `packages/core` runs `scripts/check-module-boundary.mjs`. It fails when a file in one module's folder imports another module's folder, unless the registry links the two modules:

- the importing module lists the other in `requires` or `enhances` (`modules.ts`), or
- a feature in `module-features.ts` names both modules.

So a new link between two modules needs a recorded reason, and that reason is also what the feature gate checks. The lint also fails on a folder under `modules/` that is not a module id. Code in the shared folders can import any module.
