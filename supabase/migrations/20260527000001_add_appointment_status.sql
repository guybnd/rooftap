-- Add status column to appointments for tracking viewed/cancelled state
ALTER TABLE appointments
  ADD COLUMN status text NOT NULL DEFAULT 'scheduled'
  CHECK (status IN ('scheduled', 'viewed', 'cancelled'));
