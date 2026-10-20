-- Add columns for nearest POI distances (in meters, straight-line)
alter table apartments add column nearest_supermarket_m integer;
alter table apartments add column nearest_transport_m integer;
