create or replace function private.live_reference_images_valid(images jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare category text; item jsonb;
begin
 if images is null or jsonb_typeof(images)<>'object' or not(images ? 'face' and images ? 'body') then return false; end if;
 if exists(select 1 from jsonb_object_keys(images) k where k not in ('face','body')) then return false; end if;
 foreach category in array array['face','body'] loop
  if jsonb_typeof(images->category)<>'array' then return false; end if;
  if jsonb_array_length(images->category)>2 then return false; end if;
  for item in select value from jsonb_array_elements(images->category) loop
   if jsonb_typeof(item)<>'string' or length(item#>>'{}') not between 40 and 600000 or
      (item#>>'{}') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then return false; end if;
  end loop;
 end loop;
 return true;
end $$;
revoke all on function private.live_reference_images_valid(jsonb) from public,anon,authenticated;

create table private.live_character_references (
 character_id uuid primary key references public.live_characters(id) on delete cascade,
 images jsonb not null default '{"face":[],"body":[]}'::jsonb check (private.live_reference_images_valid(images)),
 updated_at timestamptz not null default now()
);
alter table private.live_character_references enable row level security;
revoke all on private.live_character_references from public,anon,authenticated;

create or replace function public.live_save_character_with_references(
 edit_token text, character_id uuid, character_name text, new_prompt text, new_voice_id text,
 new_voice_name text, new_avatar_url text, make_default boolean, new_sort_order integer,
 expected_version integer, new_reference_images jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
 if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
 if not private.live_reference_images_valid(new_reference_images) then raise exception 'invalid reference images' using errcode='22023'; end if;
 saved=public.live_save_character(edit_token,character_id,character_name,new_prompt,new_voice_id,new_voice_name,new_avatar_url,make_default,new_sort_order,expected_version);
 insert into private.live_character_references(character_id,images)
 values((saved->>'id')::uuid,new_reference_images)
 on conflict on constraint live_character_references_pkey do update set images=excluded.images,updated_at=now();
 return saved || jsonb_build_object('reference_images',new_reference_images);
end $$;
revoke all on function public.live_save_character_with_references(text,uuid,text,text,text,text,text,boolean,integer,integer,jsonb) from public;
grant execute on function public.live_save_character_with_references(text,uuid,text,text,text,text,text,boolean,integer,integer,jsonb) to anon,authenticated;

create or replace function public.live_read_character_references(server_token text,target_character uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from private.live_history_key where key_hash=encode(extensions.digest(server_token,'sha256'),'hex')) then
  raise exception 'invalid server capability' using errcode='28000';
 end if;
 select images into result from private.live_character_references r where r.character_id=target_character;
 return coalesce(result,'{"face":[],"body":[]}'::jsonb);
end $$;
revoke all on function public.live_read_character_references(text,uuid) from public;
grant execute on function public.live_read_character_references(text,uuid) to anon,authenticated;

create or replace function public.live_list_characters(edit_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order,c.created_at,c.id),'[]'::jsonb) into result
 from (
  select c.id,c.name,c.prompt,c.voice_id,c.voice_name,c.avatar_url,c.is_default,c.sort_order,c.version,c.created_at,c.updated_at,
   coalesce(r.images,'{"face":[],"body":[]}'::jsonb) as reference_images
  from public.live_characters c left join private.live_character_references r on r.character_id=c.id
 ) c;
 return result;
end $$;
notify pgrst,'reload schema';
