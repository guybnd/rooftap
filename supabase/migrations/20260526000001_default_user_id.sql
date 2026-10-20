-- Auto-fill user_id from the authenticated user so client inserts don't need to pass it explicitly
alter table apartments alter column user_id set default auth.uid();
alter table checklist_items alter column user_id set default auth.uid();
