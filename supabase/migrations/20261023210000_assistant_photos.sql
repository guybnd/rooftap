-- Photos in Assistant chats. A person attaches a photo to a message and the
-- Assistant reads it and files what it finds with its tools.
--
-- Additive and safe ahead of code: one new nullable column that older code
-- never reads or writes, and a new private bucket. The bucket has no
-- storage policies on purpose: apps can't list, read or write it directly.
-- The server hands out one-time upload slots under the household's folder,
-- signs short-lived links to show a photo to the people in its conversation,
-- and deletes photos after the household's keep time. Apps only offer photos
-- when /api/assistant/status says the server takes them.

-- Storage paths of the photos sent with a message: <group>/<day>/<user>-<id>.<ext>.
alter table assistant_messages add column if not exists photos text[];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assistant-photos',
  'assistant-photos',
  false,
  20971520,                                     -- 20 MB; the server shrinks each photo after it arrives
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;
