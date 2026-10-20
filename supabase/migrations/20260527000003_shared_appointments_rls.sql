-- Fix appointments RLS: replace per-user policies with shared authenticated access
-- (consistent with all other tables after 20260526000002_shared_access.sql)

DROP POLICY "Users can insert their own appointments." ON appointments;
DROP POLICY "Users can update their own appointments." ON appointments;
DROP POLICY "Users can delete their own appointments." ON appointments;
DROP POLICY "Users can select their own appointments." ON appointments;

CREATE POLICY "Authenticated users can manage all appointments"
  ON appointments FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
