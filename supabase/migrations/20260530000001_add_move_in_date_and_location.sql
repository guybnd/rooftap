-- Add move-in date and main location to apartments
alter table apartments add column if not exists move_in_date date;
alter table apartments add column if not exists main_location text;
