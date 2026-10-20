-- Add home profile columns to groups table
alter table groups
add column home_address text null,
add column home_lat numeric null,
add column home_lng numeric null,
add column home_move_in_date date null,
add column chosen_apartment_id uuid null references apartments(id) on delete set null;

-- Create indexes for common queries
create index idx_groups_home_address on groups(home_address) where home_address is not null;
create index idx_groups_chosen_apartment on groups(chosen_apartment_id) where chosen_apartment_id is not null;
