-- Add 'optional', 'skipped', and 'rebook' to appointment status enum
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('scheduled', 'viewed', 'cancelled', 'optional', 'skipped', 'rebook'));
