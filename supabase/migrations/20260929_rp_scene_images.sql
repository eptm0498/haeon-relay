-- Private character references and generated RP scenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rp-studio-private', 'rp-studio-private', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy rp_storage_read on storage.objects for select to authenticated
using (bucket_id = 'rp-studio-private' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt()->>'email') = 'eptm0498+rp@gmail.com');
create policy rp_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'rp-studio-private' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt()->>'email') = 'eptm0498+rp@gmail.com');
create policy rp_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'rp-studio-private' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt()->>'email') = 'eptm0498+rp@gmail.com');

create table public.rp_character_references (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
 character_id uuid not null references public.rp_characters(id) on delete cascade,
 path text not null unique, label text not null default '기준 이미지',
 created_at timestamptz not null default now()
);
create table public.rp_scene_images (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
 session_id uuid not null references public.rp_sessions(id) on delete cascade,
 character_id uuid not null references public.rp_characters(id) on delete cascade,
 anchor_message_id uuid references public.rp_messages(id) on delete set null,
 anchor_ordinal bigint not null default 0, path text not null unique,
 snapshot jsonb not null, model text not null, softened boolean not null default false,
 created_at timestamptz not null default now()
);
create index rp_character_references_character_idx on public.rp_character_references(character_id);
create index rp_scene_images_session_idx on public.rp_scene_images(session_id,anchor_ordinal,created_at);
alter table public.rp_character_references enable row level security;
alter table public.rp_scene_images enable row level security;
create policy rp_owner_only on public.rp_character_references for all to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->>'email') = 'eptm0498+rp@gmail.com')
with check (owner_id = (select auth.uid()) and (select auth.jwt()->>'email') = 'eptm0498+rp@gmail.com');
create policy rp_owner_only on public.rp_scene_images for all to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->>'email') = 'eptm0498+rp@gmail.com')
with check (owner_id = (select auth.uid()) and (select auth.jwt()->>'email') = 'eptm0498+rp@gmail.com');
grant select, insert, update, delete on public.rp_character_references, public.rp_scene_images to authenticated;
