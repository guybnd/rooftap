-- Add room tag and main image flag to photos
alter table photos add column if not exists room text;
alter table photos add column if not exists is_main boolean not null default false;

-- Ensure only one main photo per apartment
create unique index if not exists photos_apartment_main_unique
  on photos (apartment_id)
  where is_main = true;
