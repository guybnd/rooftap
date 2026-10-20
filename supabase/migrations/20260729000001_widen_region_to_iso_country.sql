-- Region was constrained to a two-value allowlist (`check (region in ('AU'))`),
-- so picking any other country failed at the database no matter what the app
-- offered. Widening that list per country would make every new region a
-- migration; instead constrain the *shape* and let the app own which regions
-- it can actually serve content for.
--
-- ISO 3166-1 alpha-2: two uppercase letters. Curated content (retailers,
-- listing sources, moving-task templates, grocery staples) stays opt-in per
-- country in packages/core/src/region; regions without it fall back to the
-- generic provider, which still formats currency correctly.

alter table groups
drop constraint if exists valid_region;

-- The old constraint allowed only 'AU', so every existing row should already
-- pass the new one. Normalise anyway: ADD CONSTRAINT validates existing rows,
-- and one out-of-band value would abort this file and, because the runner
-- stops on error, block every later migration too.
update groups
set region = upper(trim(region))
where region is not null and region <> upper(trim(region));

update groups
set region = 'AU'
where region is null or upper(trim(region)) !~ '^[A-Z]{2}$';

alter table groups
add constraint valid_region check (region ~ '^[A-Z]{2}$');

comment on column groups.region is
  'ISO 3166-1 alpha-2 country code. Drives currency formatting for every region, plus curated content where packages/core/src/region has a provider for it.';
