-- Add missing fields to setup_items table
alter table setup_items
add column if not exists actual_price integer,
add column if not exists url text,
add column if not exists notes text;
