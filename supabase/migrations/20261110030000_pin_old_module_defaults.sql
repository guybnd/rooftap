-- New households now start with Groceries, Recipes and Costs on (registry
-- default in core MODULES). A household that has already chosen its tiles
-- keeps what it had: for every household with at least one group_modules
-- row, write an explicit "off" row for each of the three it has no row for,
-- so the new default does not switch them on.
--
-- A household with no rows yet has not chosen, so it gets the first-run
-- picker with the new defaults.
--
-- Data only and additive: it inserts rows and never changes one, and the
-- rows match what the app before this change already resolved.
insert into public.group_modules (group_id, module_id, enabled)
select g.group_id, m.module_id, false
from (select distinct group_id from public.group_modules) g
cross join (values ('groceries'), ('recipes'), ('costs')) as m(module_id)
on conflict (group_id, module_id) do nothing;
