-- Bot API keys never expire unless their owner picks a lifetime (Guy,
-- 2026-10-19). Undo the 90-day expiry that 20261019031000 backfilled onto
-- existing keys and that the first version of the code gave new ones, since
-- nobody chose it.
--
-- 'infinity' rather than null: the code already deployed treats a null
-- expires_at as created_at + 90 days, so null would briefly lock out older
-- keys between this migration and the new code going live. Both versions read
-- 'infinity' as never expiring (Date.parse can't parse it).

update personal_access_tokens
set expires_at = 'infinity'
where revoked_at is null and expires_at is not null;
