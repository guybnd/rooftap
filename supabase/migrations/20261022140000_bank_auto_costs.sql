-- Up Bank connector, part four: joint payments become cost lines.
--
-- With auto_costs on, the server files each payment from a person's shared
-- joint accounts under a cost line for its vendor. A vendor with no line yet
-- gets one, marked bank_source = 'up', with a link rule so its later payments
-- land there too. The server keeps such a line's amount and cadence in step
-- with the real payments; its name and category stay the household's to
-- change.
--
-- Additive and safe ahead of code: two defaulted columns, one nullable
-- column and a looser length check on bank_links.match. Code that predates
-- them never reads them, and the apps only offer the switch on servers that
-- have it ('connectors.up-bank-auto' in
-- packages/core/src/server-features.ts).

alter table public.up_bank_connections
  add column if not exists auto_costs boolean not null default false;

alter table public.cost_items
  add column if not exists bank_source text check (bank_source in ('up'));

-- A rule the server made for joint spending fits payments from joint
-- accounts only, so a person's own card at the same shop stays theirs.
alter table public.bank_links
  add column if not exists joint_only boolean not null default false;

-- A merged line's rule keeps each payee it took in, joined by ' | ', so the
-- longest a match may be grows to fit a few of them.
alter table public.bank_links drop constraint if exists bank_links_match_check;
alter table public.bank_links add constraint bank_links_match_check
  check (length(match) between 2 and 1000);

-- Four more cost categories, so everyday joint spending has somewhere to go
-- besides Other: Transport, Health, Pets, and Kids and family. Existing rows
-- are untouched; older apps show a line in an unknown category as Other.
alter table public.cost_items drop constraint if exists cost_items_category_check;
alter table public.cost_items add constraint cost_items_category_check
  check (category in ('rent','utilities','internet','insurance','subscription','grocery_estimate','moving','purchase','outing','transport','health','pets','family','other'));
