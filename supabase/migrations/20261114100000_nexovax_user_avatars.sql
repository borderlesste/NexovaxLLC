-- Profile photos: private bucket served through the API (/api/media/:id).
-- Objects are scoped to their owner: <user_id>/avatar/<uuid>.webp

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nx-user-avatars', 'nx-user-avatars', false, 1048576, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.assets drop constraint if exists nx_assets_avatar_bucket_user_key_scope;
alter table public.assets add constraint nx_assets_avatar_bucket_user_key_scope check (
  storage_bucket is distinct from 'nx-user-avatars'
  or (storage_provider = 'SUPABASE' and owner_seller_id is null and uploaded_by_user_id is not null
      and storage_key like (uploaded_by_user_id::text || '/avatar/%'))
);
