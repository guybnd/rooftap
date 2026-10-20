-- Modules (.docs/modules.md): Google Calendar sync and MCP become modules.
--
-- Both existed before modules did, so existing households keep them on, the
-- same way 20261018044000_create_group_modules.sql kept the original nine on.
-- New households start from the registry default (off) and switch them on in
-- Settings > Modules.
--
-- Additive and safe ahead of the code: rows for module ids the running app
-- doesn't know yet are ignored by resolveEnabledModules.
insert into public.group_modules (group_id, module_id, enabled)
select g.id, m.module_id, true
from public.groups g
cross join (values ('google-calendar'), ('mcp')) as m(module_id)
on conflict (group_id, module_id) do nothing;
