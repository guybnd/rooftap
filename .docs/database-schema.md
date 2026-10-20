# Database Schema

All tables live in Supabase (PostgreSQL). Row-Level Security (RLS) is enabled on all tables — users can only access their own rows via `auth.uid() = user_id`.

## apartments

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid FK | → auth.users |
| address | text NOT NULL | Full street address |
| suburb | text | |
| rent_per_week | int | AUD |
| bedrooms | int | |
| bathrooms | int | |
| parking | bool | |
| listing_url | text | Original listing URL |
| notes | text | Free-text notes |
| lat | float8 | For map view |
| lng | float8 | For map view |
| created_at | timestamptz | now() |
| updated_at | timestamptz | now() |

## checklist_items

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK | → auth.users |
| label | text NOT NULL | e.g. "Natural light" |
| category | text | e.g. "Essentials" |
| weight | int | 1–10, default 5 |
| is_dealbreaker | bool | default false |
| order | int | Display order |
| created_at | timestamptz | |

## checklist_responses

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| apartment_id | uuid FK | → apartments |
| checklist_item_id | uuid FK | → checklist_items |
| value | bool | nullable — null = N/A |
| notes | text | |

## photos

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| apartment_id | uuid FK | → apartments |
| storage_path | text NOT NULL | Supabase Storage path |
| caption | text | |
| created_at | timestamptz | |

## apartment_comments

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| apartment_id | uuid FK | → apartments (cascade delete) |
| user_id | uuid FK | → auth.users (cascade delete) |
| content | text NOT NULL | Comment body |
| created_at | timestamptz | now() |

## household_tasks

Household Management section (FLUX-60; promoted to its own section in FLUX-69, route `/tasks`). Generic household tasks & reminders — recurring chores, errands, and moving-template tasks all live here. Group-scoped via RLS (`is_group_member(group_id)`).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| title | text NOT NULL | Task description |
| due_date | date | Optional due date (YYYY-MM-DD) |
| due_time | time | Optional wall-clock time of day (FLUX-144); null = all-day. Interpreted in the viewer's local zone — deliberately not a timestamptz |
| offset_days | int | Days relative to move-in date, for move-template tasks |
| recurrence_days | int | Non-null = recurring; completing one schedules the next occurrence this many days ahead |
| done | bool | default false |
| assigned_to | uuid FK | → auth.users (set null on delete); null = unassigned |
| private | bool | default false |
| template_key | text | Non-null = generated from a template; makes regeneration idempotent and powers date-shift |
| notes | text | Free-text notes |
| priority | text | low/medium/high (FLUX-182); default 'medium', CHECK-constrained, nullable. Mirrors `setup_items.priority`; surfaced by the redesigned to-do modal's priority slider |
| sort_order | int | default 0 |
| created_at | timestamptz | now() |
| updated_at | timestamptz | now() — bumped on every write by the `handle_times()` trigger (FLUX-148) |
| deleted | bool | default false — soft-delete tombstone for offline sync (FLUX-148) |

**Sync-ready columns (FLUX-148, for the Legend-State local-first migration FLUX-147):** both `household_tasks` and `grocery_items` carry `created_at`/`updated_at`/`deleted` and a `before insert or update` trigger `handle_times()` that sets `updated_at = now()` on every write (and keeps `created_at` immutable). This lets an incremental `changesSince` sync pull only rows changed since the client's last sync, and learn about deletions via the `deleted` tombstone instead of hard-deletes. Indexed `(group_id, updated_at)` on both tables for those scoped pulls. Soft-delete *usage* (writing `deleted=true` instead of `DELETE`) arrives with the Legend-State pilot (FLUX-149); until then the app still hard-deletes and the column stays `false`.

The curated moving template lives in the region provider (`src/lib/region/*`, `movingTasks[]`) so regions can differ. Generation, idempotency, recurrence respawn, and move-in date-shift helpers are in `src/app/setup/moving-tasks.ts`.

## events (FLUX-249)

Dedicated, group-scoped, group-visible calendar events ("doctor appointment", "moving day", "rent due") — distinct from the user-scoped `appointments` (apartment viewings) and the read-only Google Calendar overlay (`google_calendar_events`). Local-first Legend-State store (`src/lib/legend/events-store.ts`), cloning the `household_tasks` sync-ready pattern. Group-scoped via RLS (`is_group_member(group_id)`). TS type is `GroupEvent` (not `CalendarEvent`, to avoid colliding with `GoogleCalendarEvent`).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| created_by | uuid FK | → auth.users (set null on delete) |
| title | text NOT NULL | |
| category | text | general (default) \| medical \| social \| household \| finance \| school \| travel \| work — CHECK-constrained; label/color map in `src/lib/events.ts` (`EVENT_CATEGORY_META`) |
| starts_at | timestamptz NOT NULL | |
| ends_at | timestamptz | nullable |
| is_all_day | bool | default false; all-day events store `starts_at` at local midnight and leave `ends_at` null |
| location | text | nullable |
| notes | text | nullable |
| private | bool | default false (shared); client-side visibility filter only (mirrors `household_tasks.private`) — NOT RLS-hard |
| created_at / updated_at | timestamptz | now() — `updated_at` bumped on every write by the shared `handle_times()` trigger |
| deleted | bool | default false — soft-delete tombstone for offline sync (same pattern as `household_tasks`) |

Indexed `(group_id, starts_at)` for calendar-range queries and `(group_id, updated_at)` for `changesSince` incremental pulls. Realtime-enabled (`replica identity full` + `supabase_realtime` publication), same as `household_tasks`/`cost_items`. An optional file attachment (e.g. a referral PDF) is **not** a column here — it reuses the central `documents`/`document_links` store via `entity_type = 'event'` (see `document_links` below), picked from existing documents or uploaded fresh.

## push_subscriptions

Web Push subscriptions for task notifications (FLUX-128). One row per browser/device push endpoint; a user may have several. Rows are **personal** — RLS scopes to `auth.uid() = user_id` (not the group-member helper). `group_id` is stored only for convenient server-side fan-out; the notify-* Edge Functions run as service-role and scope by assignee explicitly.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid FK | → auth.users (cascade delete) |
| group_id | uuid FK | → groups (cascade delete) |
| endpoint | text NOT NULL UNIQUE | push service endpoint URL |
| p256dh | text NOT NULL | subscription public key |
| auth | text NOT NULL | subscription auth secret |
| user_agent | text | device hint, for the user's own reference |
| created_at | timestamptz | now() |

Subscriptions are written via `POST /api/push/subscribe` and removed via `DELETE` (same route). Sends originate from Supabase Edge Functions (`supabase/functions/notify-*`); stale endpoints (web-push 404/410) are pruned on send. Phase-2 event pushes are driven by DB triggers (`trg_notify_task_assigned`, `trg_notify_task_comment`) that call the functions via `pg_net`; the daily reminder is a `pg_cron` job. See `supabase/functions/README.md`.

## device_push_tokens

Expo push tokens for native (Android/iOS) task notifications (HOUP-154). Sibling table to `push_subscriptions`, not an extension of it — an Expo push token is a single opaque string with no keypair, unlike VAPID web-push subscriptions. Same personal-row RLS shape (`auth.uid() = user_id`) and `group_id`-for-fan-out convention.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid FK | → auth.users (cascade delete) |
| group_id | uuid FK | → groups (cascade delete) |
| expo_push_token | text NOT NULL UNIQUE | from `Notifications.getExpoPushTokenAsync()` |
| platform | text NOT NULL | `android` \| `ios` |
| device_id | text | nullable, optional client hint |
| created_at | timestamptz | now() |

Tokens are written via `POST /api/push/device-token` and removed via `DELETE` (same route), authenticated through the shared Bearer-capable `getSessionUser` (`apps/web/src/lib/supabase/session.ts`) since native has no cookie jar for the web origin. Sends go through the same `sendToUsers()` fan-out as web push (`supabase/functions/_shared/send-push.ts`), via the Expo Push API (`https://exp.host/--/api/v2/push/send`); tokens Expo reports `DeviceNotRegistered` are pruned on send.

## cost_items

Costs / Budget section (FLUX-66). Recurring and one-off household cost lines. Group-scoped via RLS (`is_group_member(group_id)`). Amounts are stored in minor units (cents).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| name | text NOT NULL | e.g. "Electricity" |
| category | text | rent \| utilities \| internet \| insurance \| subscription \| grocery_estimate \| moving \| purchase \| other |
| amount | int | minor units (cents) |
| cadence | text | weekly \| fortnightly \| monthly \| quarterly \| yearly \| one_off |
| is_estimate | bool | rough vs locked-in |
| start_date / end_date | date | contract term; `end_date` drives an expiry reminder |
| discount_end_date | date | intro-rate / joining-discount expiry → reminder |
| provider | text | vendor |
| assigned_to | uuid FK | → auth.users (set null); who pays |
| linked_section | text | e.g. 'home_search' (rent), 'home_setup' (one-off), 'warranties' (asset purchase) for cross-section seeding |
| notes | text | |
| sort_order | int | default 0 |
| created_by | uuid FK | → auth.users (cascade) |
| created_at / updated_at | timestamptz | now() |

Period normalization (weekly/monthly/yearly) lives in `src/lib/costs.ts`. One-offs are not amortized — they count once toward the yearly total. Expiry dates sync into `household_tasks` reminders via the shared reminder engine `src/lib/reminders.ts` (FLUX-116; `cost-reminders.ts` delegates to it). Reminders are keyed by a stable `template_key = <prefix>:{originId}:{sub}` — `cost-reminder:{costId}:{contract|discount}`, `doc-reminder:{docId}:expiry`, `tracked-item-reminder:{id}:expiry` — created/updated/removed idempotently, due 14 days before expiry (or today if sooner). The origin (cost/document) surfaces an "Open reminder" link to `/tasks?focus=<taskId>`, and the task card shows a "from Costs/Documents" backlink — `parseReminderKey` maps a template_key back to its origin.

## cost_documents

Documents attached to a cost line (contracts, bills, receipts). Stored in the private `cost-documents` bucket; the UI mints signed URLs to view. Group-scoped via the parent `cost_items` row.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| cost_item_id | uuid FK | → cost_items (cascade) |
| storage_path | text | path in `cost-documents` bucket |
| filename | text | original name |
| doc_type | text | contract \| bill \| receipt \| other |
| uploaded_by | uuid FK | → auth.users (cascade) |
| created_at | timestamptz | now() |

> **Retired (FLUX-132):** `warranty_assets` + `warranty_files` (the old Warranties & Receipts section) were dropped in the docs-centric pivot. Warranties/insurance/vehicle/lease are now ordinary **documents** (category + `metadata` + filtered views); expiry → reminder and cost linkage are handled by the documents model. The `tracked_items` table briefly added in FLUX-131 was also reverted.

## documents

Central document store (FLUX-98). The single group-scoped store all capture/intake flows write into — invoices, receipts, warranties, manuals, contracts, photos, plus the expanded household categories from FLUX-113 (IDs, insurance, leases, tax, medical, vehicle, appliance manuals). Greenfield/additive: the legacy `cost_documents`, `warranty_files`, and grocery `receipt_path` silos keep working and are unified later (FLUX-106). Files live in the private `documents` bucket; the UI mints signed URLs to view. Group-scoped via `is_group_member(group_id)`. Helpers in `src/lib/documents.ts` (validate/upload/register/link/list/sign/rename/update-metadata/delete; `DOC_TYPE_META`/`docTypeLabel` for category label+colour) — **land here first** for anything touching document storage.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade); denormalized for RLS |
| storage_path | text | path in the `documents` bucket |
| filename | text | original name |
| mime_type | text | nullable |
| size_bytes | int | nullable |
| doc_type | text | invoice \| receipt \| warranty \| manual \| contract \| photo \| other \| id_personal \| insurance \| lease_contract \| tax_financial \| medical \| vehicle \| appliance_manual (FLUX-113) |
| title | text | nullable; user-editable label |
| parsed | jsonb | nullable; raw `/api/parse-receipt` output when parsed |
| source | text | capture \| cost \| warranty \| grocery \| other (where it entered the store) |
| expiry_date | date | nullable; FLUX-113 — warranties/IDs/insurance/rego; partial-indexed; feeds expiry reminders/badges |
| tags | text[] | NOT NULL default `'{}'`; FLUX-113 — free-text filing tags, lowercased/de-duped on save |
| metadata | jsonb | NOT NULL default `'{}'`; FLUX-133 — per-category sub-fields (warranty manufacturer/model/serial/purchase_date, insurance provider/policy_no/premium, vehicle rego/make/model, lease counterparty/property/start_date). Schema in `src/lib/document-fields.ts` |
| uploaded_by | uuid FK | → auth.users (cascade) |
| created_at | timestamptz | now() |

**RLS (FLUX-113):** the original single `FOR ALL` policy was split — select/insert/update are open to any group member (collaborative household: anyone can rename/recategorise a shared document), but **delete is restricted to the uploader or a group `owner`**.

## document_links

Polymorphic many-to-many join so one document can serve multiple services ("use it for each service accordingly"). Group-scoped via its own denormalized `group_id`. Unique per `(document_id, entity_type, entity_id)`; indexed on `(entity_type, entity_id)` for service-side lookups.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| document_id | uuid FK | → documents (cascade) |
| group_id | uuid FK | → groups (cascade); denormalized for RLS |
| entity_type | text | cost_item \| grocery_session \| setup_item \| recipe (FLUX-202) \| event (FLUX-249) |
| entity_id | uuid | the linked service row's id |
| link_role | text | nullable; e.g. bill \| receipt \| manual |
| created_at | timestamptz | now() |

## Comment tables

`setup_item_comments`, `household_task_comments`, and `cost_item_comments` share the same shape (`id`, `<entity>_id` FK, `user_id`, `content`, `created_at`) and are rendered by the generic `EntityComments` component (`src/components/entity-comments.tsx`, parameterized by table + fk column). Group-scoped via the parent entity's RLS.

## user_settings

Per-user preferences (one row per user, `unique (user_id)`). Auto-loaded, realtime-synced, and offline-cached via `src/lib/data-cache.tsx` (`select("*")`). RLS: `auth.uid() = user_id`. New per-user prefs go here (a column + a panel) rather than a new table.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid FK | → auth.users (cascade); unique |
| rent_min / rent_max | int | Home Search weekly rent budget range |
| appointment_duration_minutes | int | default appointment length |
| default_section | text | section id to open on launch; null = last used |
| last_used_section | text | most recently visited section (default 'search') |
| hidden_sections | jsonb | FLUX-65: section ids hidden from the sidebar switcher (default `[]`) |
| section_order | jsonb | FLUX-165: per-user section id order for the switcher; unknown/new sections keep declaration order at the end (default `[]`) |
| costs_period | text | FLUX-65: Costs default period — weekly \| monthly \| yearly |
| costs_budget_monthly | int | FLUX-65: monthly budget target, **in cents** |
| costs_this_month_only | boolean | FLUX-1560: Costs "This month" filter toggle (default true) |
| costs_hide_section_suggestions | boolean | FLUX-1560: "From your other sections" suggestion block dismissed (default false) |
| grocery_aisle_order | jsonb | FLUX-65: synced aisle display order (replaces the `homeup_grocery_aisle_order` localStorage pref) |
| grocery_aisle_units | jsonb | FLUX-65: per-aisle default unit map (aisle id/custom name → unit), default `{}`; prefills new items |
| reminder_lead_days | int | FLUX-65: Household default reminder lead time in days (default 14) |
| calendar_todo_mode | text | FLUX-228: undated (due_date, no due_time) task push mode — `all_day` (default, unchanged) or `timed_block` |
| calendar_todo_default_time | text | FLUX-228: 24h "HH:MM" block start time when `calendar_todo_mode='timed_block'` (default '09:00') |
| calendar_todo_default_duration_minutes | int | FLUX-228: block length, one of 15/30/60 (default 30) |
| calendar_show_pulled_events_in_todo | boolean | FLUX-228: show pulled Google Calendar events in the `/home` to-do feed, independent of the Home Search section-hidden toggle (default true) |
| timezone | text | FLUX-228: IANA timezone for wall-clock ↔ Google event conversion (default 'Australia/Sydney', the prior hardcoded value) |
| home_hero_modules | jsonb | FLUX-253: summary-hero module registry on/off map (module key → boolean), default `{}`; missing key falls back to the module's own `defaultOn` (see `src/app/home/hero-modules.tsx`) |
| checklists_completed_to_bottom | boolean | HOUP-327: account default — sink completed items below a collapsible band on the checklist detail screen (default true). Per-list device-local override lives outside this table (`homeup_checklist_view_prefs` via `keyValue`) |
| checklists_collapse_completed | boolean | HOUP-327: account default — the completed band starts collapsed (default false) |
| checklists_default_sort | text | HOUP-327: account default checklist sort mode — `manual` \| `alpha` \| `price` \| `recent` (default `manual`); resolved per-list against `availableSortModes(type)` since `price` only applies to Shopping lists |
| mcp_enabled | boolean | HOUP-26: on/off for this user's PAT-authenticated MCP server access (default true) |
| mcp_read_only | boolean | HOUP-26: when true, only read-kind MCP tools may register — intersects `mcp_allowed_tools` rather than overriding it (default false) |
| mcp_allowed_tools | text[] | HOUP-26: MCP tool name allowlist; `null` = every tool, `[]` = none (default null). Tool identity/kind lives in `src/lib/mcp-tools.ts` (`MCP_TOOLS`); the registration gate is `toolAllowed()` in `src/lib/mcp-settings.ts`, applied per-request in `buildServer()` (`src/app/api/mcp/route.ts`) |
| created_at / updated_at | timestamptz | now() |

The settings hub (`src/app/settings/`) is a tabbed surface: a Global tab (`/settings`) plus one deep-linkable tab per enabled section (`/settings/<id>`). Panels are registered in `src/app/settings/settings-registry.ts` (single source of truth — adding a panel is one edit there). `hidden_sections` and `section_order` (FLUX-165: drag-to-reorder list in `src/components/navigation-settings.tsx`, applied via `orderSections()` in `src/lib/sections.ts` before the hidden filter) are read/written through `useSectionSettings()` (`src/lib/use-section.ts`), which also reflects changes same-tab (window event) and cross-device (a per-user `user_settings` realtime subscription) so the sidebar updates without a reload.

## group_modules

Household module switches ([modules.md](modules.md)). One row per `(group_id, module_id)` the owner has switched; no row means the module's `defaultEnabled` in `packages/core/src/modules.ts`, so a new module needs no data migration. `module_id` is free text (no CHECK or enum) for the same reason. The migration seeded every household that existed then with all nine modules on. RLS: members select (`is_group_member`), only the owner (`group_members.role = 'owner'`) inserts or updates. Realtime-published; both platforms load it in `fetchGroupData()` and refetch on change. A failed read (e.g. a self-hosted DB that hasn't run the migration) leaves every module on rather than hiding anything.

| Column | Type | Notes |
|--------|------|-------|
| group_id | uuid FK | → groups (cascade); PK with module_id |
| module_id | text | a `ModuleId`; unknown ids are ignored by clients |
| enabled | boolean | the owner's switch |
| updated_by | uuid FK | → auth.users (set null); stamped server-side from `auth.uid()` |
| created_at / updated_at | timestamptz | `handle_times()` |

What a server offers at all is separate: the `HOMEUP_MODULES` env var (comma-separated ids, unset = all), served as `modules` by `/api/public-config`. Effective set = offered ∩ switched on, minus modules with an unmet `requires`.

## setup_items

Home Setup section (FLUX-59/61). Room-by-room move-in shopping list, group-scoped via RLS (`is_group_member(group_id)`). Local-first via Legend-State (FLUX-150 slice 3, `src/lib/legend/setup-items-store.ts`).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| name | text NOT NULL | |
| description | text | |
| room | text | free-text room name |
| status | text NOT NULL | `needed` \| `installed` (labeled "Got It"; FLUX-240 collapsed the original 5-value pipeline — `researching`/`ordered`/`delivered` were folded into `needed`), CHECK-constrained, default `'needed'` |
| priority | text NOT NULL | low/medium/high, default 'medium'. Mirrors `household_tasks.priority` |
| est_price / actual_price | int | |
| where_to_buy | text | free-text; retained for back-compat/backfill — superseded by `store_id` |
| store_id | uuid FK | → setup_stores (set null on delete) |
| url | text | product link |
| notes | text | |
| assigned_to | uuid FK | → auth.users (set null) |
| template_key | text | non-null = generated from a starter template |
| sort_order | int | default 0 |
| created_by | uuid FK | → auth.users (cascade) |
| created_at / updated_at | timestamptz | now() |

**Budget semantics (FLUX-240):** with only two statuses, "spent" = Σ `actual_price` over `installed` items; "outstanding"/"remaining" = `needed` items. `src/app/setup/setup-status.ts`'s `summarize()` is the single place this rollup lives — the page's progress strip, room rollups, the `SegmentedBar`, `BudgetSummary`, and the home hub tile (`section-tiles.tsx`) all consume it rather than re-deriving totals.

## setup_stores

Home Setup stores — first-class store entities (name + optional link/address), **group-scoped** (`is_group_member(group_id)`), shared across the group. Powers both the per-item store picker (`src/components/store-select.tsx`) and the Stores management panel under Settings → Home Setup (`src/components/setup-stores-settings.tsx`, FLUX-65).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| name | text NOT NULL | unique per group |
| url | text | optional link |
| address | text | optional address |
| created_by | uuid FK | → auth.users (cascade) |
| created_at | timestamptz | now() |

`setup_items.store_id` → setup_stores (set null on delete); `where_to_buy` is retained for back-compat/backfill.

## Checklists (FLUX-156)

A general-purpose, group-shared checklist tool (`/checklists`) — **distinct** from the legacy apartment-scoring `checklist_items` table (nav relabelled "Apartment Checklist"). Four new tables, all **group-scoped** (`is_group_member(group_id)`) with the full Legend-State sync contract (`created_at`/`updated_at` + `handle_times()` trigger, `(group_id, updated_at)` index, `deleted` tombstone, `replica identity full` + `supabase_realtime` publication). Migration `20260710000002_create_checklists.sql`. Cross-section: a dated checklist links a `household_tasks` row (dashboard to-do); a Shopping check logs a `cost_items` row (`linked_section = 'checklists'`, no cost-table schema change).

### checklists
Item table is named `checklist_task_items` to avoid colliding with legacy `checklist_items`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| title | text NOT NULL | |
| type | text NOT NULL | `plain` \| `repeating` \| `shopping` (default `plain`). "Scheduled" is NOT a type — a date is a cross-cutting attribute |
| template_key | text | well-known starter-template key this list came from |
| source_checklist_id | uuid FK | → checklists (set null); prior run this was cloned from |
| completed_at | timestamptz | archived/done marker (Start again / clone renewal) |
| scheduled_date | date | optional due date → drives the linked dashboard to-do |
| linked_task_id | uuid | `household_tasks` row created for the date |
| log_costs | boolean NOT NULL | Shopping: log a `cost_items` row on check (default false) |
| repeat_cadence_days | int | Repeating cadence |
| repeat_renewal_mode | text | `clone` \| `reset` (renewal behaviour on the cadence date) |
| created_by | uuid FK | → auth.users (set null) |
| created_at / updated_at | timestamptz | sync contract |
| deleted | boolean NOT NULL | soft-delete tombstone (default false) |

### checklist_task_items

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| checklist_id | uuid FK | → checklists (cascade delete) |
| group_id | uuid FK | → groups (cascade delete) |
| label | text NOT NULL | |
| is_done | boolean NOT NULL | default false |
| checked_by | uuid FK | → auth.users (set null); attribution — who checked it |
| checked_at | timestamptz | attribution — when (cleared on uncheck) |
| cost_cents | int | Shopping: unit cost in minor units (cents) |
| linked_cost_item_id | uuid | reverse pointer to the `cost_items` row logged on check |
| order | int NOT NULL | display order (quoted `"order"` — reserved word) |
| created_at / updated_at | timestamptz | sync contract |
| deleted | boolean NOT NULL | soft-delete tombstone |

### checklist_templates
User-authored, group-shared, **editable** templates. Starter templates ship as seeded rows (idempotent by `template_key`), editable thereafter.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| title | text NOT NULL | |
| default_type | text | `plain` \| `repeating` \| `shopping` (nullable) |
| default_cadence_days | int | Repeating default cadence |
| template_key | text | well-known key for seeded starters (null for user-authored) |
| created_by | uuid FK | → auth.users (set null) |
| created_at / updated_at | timestamptz | sync contract |
| deleted | boolean NOT NULL | soft-delete tombstone |

### checklist_template_items

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| template_id | uuid FK | → checklist_templates (cascade delete) |
| group_id | uuid FK | → groups (cascade delete) |
| label | text NOT NULL | |
| default_cost_cents | int | Shopping default unit cost (cents) |
| order | int NOT NULL | display order (quoted `"order"`) |
| created_at / updated_at | timestamptz | sync contract |
| deleted | boolean NOT NULL | soft-delete tombstone |

### household_tasks (additive)
`linked_checklist_id uuid` (nullable) — when a to-do was created for a dated checklist, the dashboard/tasks card deep-links to `/checklists/<id>`. No other change.

## Recipes (FLUX-189)

A group-shared recipe book (`/recipes`) whose ingredients name-match against `grocery_items` to drive a live have/need fill bar and one-tap "add missing to the shopping list". Two new tables, both **group-scoped** (`is_group_member(group_id)`) with the full Legend-State sync contract (`created_at`/`updated_at` + `handle_times()` trigger, `(group_id, updated_at)` index, `deleted` tombstone, `replica identity full` + `supabase_realtime` publication). Migration `20260711000003_create_recipes.sql`. The recipe→grocery link is **name-based** (no FK) and lives in app code (`src/lib/recipes.ts`); the ephemeral note lives on `grocery_items` (below).

**FLUX-202 "Scan a recipe":** a photo is parsed by Google Gemini (`src/lib/ai/parser.ts` `parseRecipeFromImages`, REST via `GEMINI_API_KEY`, `/api/parse-recipe`) into title/ingredients/steps/servings/times, immediately saved as a `draft=true` recipe + ingredient rows, and opened in the review sheet. **Save** flips `draft=false`; **Discard** soft-deletes the draft + unlinks its photo; leaving mid-review keeps the draft (resumable from a "Drafts (N)" strip on `/recipes`). The source photo is compressed client-side and persisted via the `documents` store, linked with `entity_type='recipe'` (see `document_links` above). `source`/`source_type` record provenance so a future URL/PDF importer needs no further migration — see the additive columns below. Migration `20260712000001_add_recipe_scan_fields.sql` (+ `20260712000002_add_recipe_document_link_type.sql` for the `document_links` check).

### recipes

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| group_id | uuid FK | → groups (cascade delete) |
| title | text NOT NULL | |
| cuisines | text[] NOT NULL | free-text cuisine tags (default `{}`) |
| method | text | check in (cooking/baking/roasting/other); null = unset/other |
| instructions | text | optional free-text prep steps; edited as an ordered step-list in the UI, stored newline-delimited (FLUX-202) |
| servings | int | FLUX-202: nullable |
| prep_minutes | int | FLUX-202: nullable |
| cook_minutes | int | FLUX-202: nullable |
| source | text | FLUX-202: free-text provenance locator — original filename/note, or a future import URL |
| source_type | text | FLUX-202: check in (photo/pdf/url/manual); this ticket writes photo/manual only |
| draft | boolean NOT NULL | FLUX-202: default false; true until the scan review sheet is Saved. Filtered out of the normal list in app code |
| created_by | uuid FK | → auth.users (set null) |
| created_at / updated_at | timestamptz | sync contract |
| deleted | boolean NOT NULL | soft-delete tombstone |

### recipe_ingredients

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| recipe_id | uuid FK | → recipes (cascade delete) |
| group_id | uuid FK | → groups (cascade delete) |
| name | text NOT NULL | full transcribed/entered descriptor line (e.g. "thinly sliced blood oranges, peeled") |
| item_name | text | FLUX-205: nullable canonical grocery item (e.g. "blood oranges"). Have/need matching + grocery-add flows key on `item_name ?? name` (normalized in app code, `ingredientMatchKey()` in `src/lib/recipes.ts`); null = falls back to matching on `name` alone |
| quantity | numeric | optional amount |
| unit | text | free text at DB level; the recipe form constrains it to a bounded dropdown (form-level only) |
| position | int NOT NULL | display order within the recipe |
| created_at / updated_at | timestamptz | sync contract |
| deleted | boolean NOT NULL | soft-delete tombstone |

### grocery_items (additive) — FLUX-189
`recipe_note text` (nullable) + `recipe_source_id uuid` (nullable, soft link — no FK). Set when a recipe pushes a missing ingredient onto the shopping list (e.g. "250 g for Lasagna"). **Distinct from `notes`** (user-owned): the recipe note auto-clears when the item's status leaves `needed` (including a manual status change), while `notes` is never touched. Migration `20260711000004_add_grocery_recipe_note.sql`.

## Google Calendar integration (FLUX-157)

Two-way sync: Rooftap appointments/dated to-dos push to every connected group member's Google Calendar; the user's whole Google Calendar pulls in as a private-by-default read-only overlay on `/calendar` and the `/home` Today hub. Migration `20260713000001_create_google_calendar_tables.sql`. **All three tables are service-role only — RLS is enabled with ZERO client policies.** Neither `anon` nor `authenticated` can query them; every read/write goes through `/api/calendar/*` routes (`src/lib/supabase/admin.ts`'s `createAdminClient()`) or the `calendar-push`/`calendar-sync` Edge Functions. Google OAuth tokens must never be reachable from a client-side Supabase query.

**FLUX-228** gives `/calendar` its own top-level nav section (previously nested under Home Search, and unresolved by `getSectionByPath()` — a real mislabel bug) and its own settings tab (`CalendarSetup` moved from `globalPanels` to `sectionPanels.calendar`), and adds: a dedicated per-connection "Rooftap" Google Calendar that all pushes target (`homeup_calendar_id`, requiring the added `calendar.calendars` OAuth scope — see below), configurable pull window/default import visibility, undated-to-do timed-block scheduling, richer invite payloads (reminders/location/deep-link), a per-user timezone (replacing the old hardcoded `Australia/Sydney`), and an independent "show pulled events in the to-do list" toggle. Migration `20260714000001_calendar_integration_settings.sql`.

### google_calendar_connections
One row per user — the dedicated "Connect Google Calendar" flow's captured tokens (separate from main sign-in, which never requests Calendar scopes).

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK | → auth.users (cascade delete) |
| access_token / refresh_token | text NOT NULL | captured by `src/app/(auth)/calendar-callback/route.ts`; refreshed via `src/lib/google-calendar.ts` (Next.js) / `supabase/functions/_shared/google-calendar.ts` (Deno) using `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (the same OAuth client configured as Supabase's Google provider) |
| expires_at | timestamptz NOT NULL | access token expiry; refreshed when within 5 minutes |
| scopes | text NOT NULL | granted scope string — FLUX-228 adds `calendar.calendars` (alongside the existing `calendar.events`/`calendar.readonly`) so Rooftap can create the dedicated "Rooftap" calendar; already-connected users must reconnect to pick up the new scope |
| selected_calendar_ids | text[] | which of the user's Google calendars to pull from; default `{primary}` |
| suggest_mode | text | `dedicated` \| `keywords` \| `both` — house-viewing suggestion classifier config |
| dedicated_calendar_id | text | nullable; used when suggest_mode includes `dedicated` — a **pull-side** classification setting, unrelated to `homeup_calendar_id` below |
| keywords | text[] | default viewing/inspection/apartment/listing/tour/showing/open house |
| homeup_calendar_id | text | FLUX-228: id of the dedicated **push-side** "Rooftap" Google Calendar all new pushes target; null until resolved by `getOrCreateRooftapCalendar()` on first push after this shipped. Already-pushed events are never migrated — they stay in `primary`; `pushEntityForMember`/`removeMemberPush` try the resolved calendar first and fall back to `primary` on a 404 |
| pull_window_past_days / pull_window_future_days | int | FLUX-228: per-connection pull window (default 7 / 30, replacing the old hardcoded constants) |
| default_import_visibility | text | FLUX-228: `private` (default) \| `group` — visibility assigned to newly-pulled `google_calendar_events` rows |
| pull_enabled | boolean | FLUX-233: master on/off for pulling this connection's calendars at all (default true). `calendar-sync`'s `pullConnection()` no-ops entirely when false |
| push_todos_enabled | boolean | FLUX-233: whether to-dos push to this member's Google Calendar (default false — opt-in; appointment push is unaffected). Gated in `calendar-push`'s `resolveTargetMembers()`, only for `entityType === "task"` |
| created_at / updated_at | timestamptz | `handle_times()` trigger |

### google_calendar_events
Staging table for **every** event pulled from the user's selected calendars (not just house-viewing invites) — never written directly into `appointments`/`household_tasks`; importing requires explicit user confirmation.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid FK | → auth.users (cascade delete) |
| gcal_event_id / gcal_calendar_id | text NOT NULL | Google's ids; `unique(user_id, gcal_event_id)` |
| title / description / location | text | from the Google event |
| starts_at / ends_at | timestamptz | ends_at nullable |
| is_all_day | boolean NOT NULL default false | captured straight from Google's `start.date` vs `start.dateTime` at pull time — the authoritative all-day flag; import derives `due_date`/`due_time` from this, never from re-inspecting `starts_at` |
| html_link | text | Google's own invite URL — rendered as "Open in Google Calendar" everywhere the event surfaces |
| visibility | text | `private` (default) \| `group` — an ad-hoc "Share to group" flip, never a push, never an entity |
| matched_apartment_id | uuid FK | → apartments, set null on delete; fuzzy-matched by the pull's classifier, pre-fills the import dialog |
| state | text | `synced` (overlay-only) \| `suggested` (classifier flagged it) \| `imported` \| `dismissed` (suggestion cleared, overlay row kept). A later pull never demotes `imported`/`dismissed` back to `synced`/`suggested` |
| imported_appointment_id / imported_task_id | uuid FK | set on import |
| created_at / updated_at | timestamptz | `handle_times()` trigger |

### google_calendar_pushed_events
Per-user push mapping: one Rooftap entity → one Google event per connected group member.

| Column | Type | Notes |
|--------|------|-------|
| user_id / entity_type / entity_id | PK | `entity_type`: `appointment` \| `task` |
| gcal_event_id | text NOT NULL | the Google event this member received |
| synced_at | timestamptz | bumped on every re-push; reconciliation compares this against the entity's `updated_at` |
| origin | text NOT NULL default `push` | `push` = Rooftap created `gcal_event_id` via the Calendar API and may freely update/delete it. `import` = the importer adopted their OWN pre-existing Google event's id into this mapping purely for echo control (Decision 6) — `pushEntityForMember`/`removeMemberPush`/the disconnect route all check this and never write to or delete an `import`-origin event; only the mapping row itself is ever touched |

### Push triggers
`household_tasks`/`appointments` each get three triggers (`_ins`/`_upd`/`_del`, mirroring the `trg_notify_task_assigned`/`_insert` split in `20260614000014`) that POST to the `calendar-push` Edge Function via the shared `public.notify_edge_function()` (same Vault-secret invoker as `notify-due-tasks`) — a DB trigger, not client code, so every write path (direct Supabase inserts, Legend-State upserts) reaches the fan-out with no per-call-site hook to remember. INSERT/DELETE always fire; the UPDATE leg carries a `WHEN` guard so only columns that affect push eligibility or the pushed event body (task: `title`/`notes`/`due_date`/`due_time`/`done`/`deleted`/`private`/`assigned_to`/`recurrence_days`/`group_id`; appointment: `apartment_id`/`scheduled_at`/`notes`) trigger an invocation — a kanban reorder or a viewing-outcome `status`/`disposition` change does not. `household_tasks` never hard-deletes from the app (soft-delete via `deleted:true`), so the Edge Function also treats that UPDATE, and completing a non-recurring to-do, as removal signals.

### Background sync
`calendar-sync` Edge Function runs every 6h via `pg_cron` (job `calendar-sync-periodic`, same `notify_edge_function()` invoker) — pulls each connection's selected calendars (per-connection `pull_window_past_days`/`pull_window_future_days`, default 7/30, `singleEvents=true`), classifies suggestions, fuzzy-matches apartments, and reconciles push state (re-push stale, back-fill newly-connected members, revoke mappings for members who fell out of push eligibility, delete orphaned mappings). Also prunes `google_calendar_events` rows for a calendar the user fully de-selects (not just stale-within-a-still-selected-calendar rows) — otherwise those rows would never be visited by a later pull and would orphan on the overlay forever. `pushEntityForMember`'s create path treats a unique-constraint violation on the mapping insert as "a concurrent invocation already won this race" — it deletes the just-created duplicate Google event rather than leaving an orphaned copy. See `supabase/functions/README.md` for the Vault secret setup shared with the `notify-*` functions, plus `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` as Supabase secrets.

### Timezone handling
`household_tasks.due_date`/`due_time` are naive wall-clock values with no zone of their own (see `20260617000002_add_household_task_due_time.sql`), and the app has no per-user/group timezone setting — it's AU-first throughout. A single `DEFAULT_CALENDAR_TIMEZONE = "Australia/Sydney"` constant (duplicated in `supabase/functions/calendar-push/index.ts` and `src/app/api/calendar/import/route.ts` — the two runtimes deliberately don't share modules) is the only place this boundary is resolved: push sends Google a naive `dateTime` + explicit `timeZone` field (never appends `Z`/UTC to a wall-clock value); import converts a pulled event's absolute `starts_at` back to a wall-clock `due_date`/`due_time` via `Intl.DateTimeFormat` in that same zone, and uses `is_all_day` (not a UTC-midnight guess) to decide whether there's a time component at all.

## Storage

Bucket: `apartment-photos`
- Path pattern: `{user_id}/{apartment_id}/{filename}`
- Policy: authenticated users can read/write their own paths

Bucket: `cost-documents` (private)
- Path pattern: `{group_id}/{cost_item_id}/{uuid}-{filename}`
- Policy: authenticated users can read/write/delete; not public — viewed via signed URLs. Metadata access is gated by `cost_documents` RLS.


Bucket: `documents` (private) — FLUX-98 central store
- Path pattern: `{group_id}/{document_id}/{uuid}-{filename}`
- Server-side limits baked into the bucket: 10 MB `file_size_limit`, `allowed_mime_types` jpg/png/webp/pdf.
- Policy: authenticated users can read/write/delete; not public — viewed via signed URLs. Metadata access is gated by `documents` RLS.
- Helpers in `src/lib/documents.ts` mirror these limits client-side.
