-- Add region column to groups table
alter table groups
add column region text not null default 'AU';

-- Create a check constraint to ensure valid regions (can expand later)
alter table groups
add constraint valid_region check (region in ('AU'));

-- Index for region-based queries
create index idx_groups_region on groups(region);
