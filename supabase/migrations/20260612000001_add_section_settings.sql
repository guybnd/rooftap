-- Add section preference columns to user_settings
alter table user_settings
add column if not exists default_section text,
add column if not exists last_used_section text default 'search';
