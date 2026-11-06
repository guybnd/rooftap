-- MCP sign-in for server-side apps that can't do PKCE, such as Home Assistant.
-- A client can register with a secret (only its hash is stored), and a code for
-- such a client carries no PKCE challenge. See apps/web/src/lib/mcp-oauth.ts.
--
-- Additive and safe ahead of its code: one new nullable column, and one column
-- that may now be null. Older code keeps sending a challenge for every code, and
-- existing clients have no secret, so they keep using PKCE.

alter table oauth_clients add column if not exists client_secret_hash text;
alter table oauth_authorization_codes alter column code_challenge drop not null;
