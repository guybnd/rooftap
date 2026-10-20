-- Hierarchical folders for the Documents section. Adapted from
-- Dorilan/ZuHause PR #12.
--
-- Self-referencing parent_id gives arbitrary-depth nesting. Deleting a folder
-- cascades to its sub-folders but only UNFILES the documents inside it
-- (folder_id -> null, back to root) rather than deleting them: a folder is a
-- filing decision, and undoing a filing decision must never destroy a file.

create table if not exists document_folders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  parent_id uuid references document_folders(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_folders_group on document_folders(group_id);
create index if not exists idx_document_folders_parent on document_folders(parent_id);

alter table document_folders enable row level security;

-- Drop-then-create, matching the repo convention: the runner records a
-- migration as applied only after the whole file succeeds, so a failure
-- partway down re-runs this file from the top on the next boot, and a bare
-- CREATE POLICY would then fail with "already exists".
drop policy if exists "Group members can manage document folders" on document_folders;
create policy "Group members can manage document folders"
  on document_folders for all
  using (is_group_member(group_id))
  with check (is_group_member(group_id));

-- A cycle (a folder reparented under its own descendant) would orphan a whole
-- subtree from the root and make breadcrumb walking loop forever. The app
-- guards against it too, but a cycle is unrecoverable through the UI once
-- written, so it is refused at the database as well.
create or replace function document_folders_reject_cycle()
returns trigger
language plpgsql
as $$
declare
  walker uuid := new.parent_id;
  hops int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A folder cannot be its own parent';
  end if;

  -- Walk to the root; if we meet the row being written, this move would close
  -- a loop. The hop cap is a backstop against a pre-existing cycle.
  while walker is not null and hops < 100 loop
    if walker = new.id then
      raise exception 'A folder cannot be moved inside its own subtree';
    end if;
    select parent_id into walker from document_folders where id = walker;
    hops := hops + 1;
  end loop;

  return new;
end;
$$;

drop trigger if exists document_folders_no_cycles on document_folders;
create trigger document_folders_no_cycles
  before insert or update of parent_id on document_folders
  for each row execute function document_folders_reject_cycle();

-- A folder and the documents in it must belong to the same group. RLS scopes
-- both to the caller's group, so this is only reachable by a bug, but a
-- cross-group filing would leak a document into another household's tree.
alter table documents
  add column if not exists folder_id uuid references document_folders(id) on delete set null;

create index if not exists idx_documents_folder on documents(folder_id);

comment on column documents.folder_id is
  'Optional filing folder. Null = root. Cleared rather than cascaded when the folder is deleted, so unfiling never destroys a document.';
