-- Replace per-user RLS with shared access for all authenticated users.
-- Login is already restricted by ALLOWED_EMAILS, so any logged-in user
-- should see all data.

-- Apartments
drop policy "Users can manage their own apartments" on apartments;
create policy "Authenticated users can manage all apartments"
  on apartments for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Checklist items
drop policy "Users can manage their own checklist items" on checklist_items;
create policy "Authenticated users can manage all checklist items"
  on checklist_items for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Checklist responses
drop policy "Users can manage responses for their apartments" on checklist_responses;
create policy "Authenticated users can manage all checklist responses"
  on checklist_responses for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Photos
drop policy "Users can manage photos for their apartments" on photos;
create policy "Authenticated users can manage all photos"
  on photos for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
