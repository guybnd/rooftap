-- A shared device: an MCP connection the person marked on the consent screen as
-- one the whole household can hear, such as a voice speaker. It gets household
-- tools as the shared chat does (anything kept from anyone left out), occasion
-- dates without gift plans, and no tools that add occasions, gift ideas or
-- wishlist items. See apps/web/src/lib/mcp-oauth.ts.
--
-- Additive and safe ahead of its code: two new columns with a false default.
-- Older code never reads them, and every existing connection stays a normal
-- one. Both tables already have RLS on with no policies, and their grants.

alter table oauth_authorization_codes add column if not exists shared_device boolean not null default false;
alter table oauth_tokens add column if not exists shared_device boolean not null default false;
