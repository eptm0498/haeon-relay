create table private.live_call_photos (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.live_characters(id) on delete cascade,
  slot smallint not null check (slot between 1 and 8),
  situation text not null check (char_length(btrim(situation)) between 1 and 240),
  image_base64 text not null check (
    char_length(image_base64) between 40 and 600000 and image_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'
  ),
  unique (character_id, slot)
);
alter table private.live_call_photos enable row level security;
revoke all on table private.live_call_photos from public, anon, authenticated;

create function public.live_call_photos_read(server_token text, target_character uuid, target_photo uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid server capability' using errcode = '28000';
  end if;
  if target_photo is not null then
    select to_jsonb(p.image_base64) into result from private.live_call_photos p
    where p.character_id = target_character and p.id = target_photo;
    return result;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'situation',p.situation) order by p.slot), '[]'::jsonb)
    into result from private.live_call_photos p where p.character_id = target_character;
  return result;
end $$;
revoke all on function public.live_call_photos_read(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.live_call_photos_read(text,uuid,uuid) to anon;

create function public.live_call_photos_edit(edit_token text, target_character uuid, action text,
  target_photo uuid default null, new_situation text default null, new_image text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; next_slot smallint;
begin
  if not coalesce(private.live_editor_ok(edit_token), false) then
    raise exception 'invalid editor capability' using errcode = '28000';
  end if;
  case action
    when 'image' then
      select to_jsonb(p.image_base64) into result from private.live_call_photos p
      where p.character_id = target_character and p.id = target_photo;
      return result;
    when 'list' then null;
    when 'add' then
      -- Serialize slot allocation for a single character.
      perform 1 from public.live_characters c where c.id = target_character for no key update;
      if not found then return null; end if;
      select n into next_slot from generate_series(1, 8) n
      where not exists (select 1 from private.live_call_photos p where p.character_id = target_character and p.slot = n)
      order by n limit 1;
      if next_slot is null then return null; end if;
      insert into private.live_call_photos(character_id,slot,situation,image_base64)
        values(target_character,next_slot,btrim(new_situation),new_image);
    when 'edit' then
      update private.live_call_photos p set situation = btrim(new_situation)
      where p.character_id = target_character and p.id = target_photo;
      if not found then return null; end if;
    when 'delete' then
      delete from private.live_call_photos p where p.character_id = target_character and p.id = target_photo;
      if not found then return null; end if;
    else raise exception 'invalid action' using errcode = '22023';
  end case;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'situation',p.situation) order by p.slot), '[]'::jsonb)
    into result from private.live_call_photos p where p.character_id = target_character;
  return result;
end $$;
revoke all on function public.live_call_photos_edit(text,uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.live_call_photos_edit(text,uuid,text,uuid,text,text) to anon;
notify pgrst, 'reload schema';
