-- MCP server settings (HOUP-26): per-user on/off, read-only, and tool allowlist
-- for the HomeUp MCP server exposed to PAT-authenticated agents.
-- null allowed_tools = every tool; empty array = none.
alter table user_settings
  add column if not exists mcp_enabled boolean not null default true,
  add column if not exists mcp_read_only boolean not null default false,
  add column if not exists mcp_allowed_tools text[];
