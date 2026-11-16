alter table private.live_call_photos
  add column tags text[] not null default '{}',
  add column use_for text not null default 'call' check (use_for in ('call','chat','both')),
  add column start_time text not null default '',
  add column end_time text not null default '',
  add column days text not null default 'daily' check (days in ('daily','weekdays','weekend')),
  drop constraint live_call_photos_slot_check,
  add constraint live_call_photos_slot_check check (
    slot between 1 and case when character_id = '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid then 250 else 8 end
  ),
  add constraint live_photo_tag_count check (cardinality(tags) <= 8),
  add constraint live_photo_time_range check (
    (start_time = '' and end_time = '') or (
      use_for <> 'chat' and start_time <> end_time
      and start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    )
  );

-- Preserve image content, descriptions, and access. Existing bedtime photos keep their original use.
update private.live_call_photos
set tags = case
  when slot in (1,2,7,10,11,23,24,27,31,34,35,36,37,38,39,40) then array['포옹','취침','침대']
  when slot in (4,29) then array['위로','취침','침대']
  when slot in (14,16,19) then array['취침','침대','클로즈업']
  when slot in (9,26,30,33) then array['휴식','취침','침대','클로즈업']
  else array['취침','침대','클로즈업']
end
where character_id = '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';

create function private.live_photo_album_list(target_character uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('id', p.id, 'situation', p.situation, 'tags', p.tags, 'useFor', p.use_for,
      'startTime', p.start_time, 'endTime', p.end_time, 'days', p.days)
    order by p.slot
  ), '[]'::jsonb)
  from private.live_call_photos p where p.character_id = target_character;
$$;
revoke all on function private.live_photo_album_list(uuid) from public, anon, authenticated;

create or replace function public.live_call_photos_read(server_token text, target_character uuid, target_photo uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid server capability' using errcode = '28000';
  end if;
  if target_photo is not null then
    return (select to_jsonb(p.image_base64) from private.live_call_photos p
            where p.character_id = target_character and p.id = target_photo);
  end if;
  return private.live_photo_album_list(target_character);
end $$;

create function public.live_jiwoo_photo_album_edit(
  edit_token text, action text, target_photo uuid default null, new_situation text default null,
  new_image text default null, details jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  next_slot smallint;
  new_tags text[];
begin
  if not coalesce(private.live_editor_ok(edit_token), false) then
    raise exception 'invalid editor capability' using errcode = '28000';
  end if;
  case action
    when 'list' then return private.live_photo_album_list(jiwoo);
    when 'image' then
      return (select to_jsonb(p.image_base64) from private.live_call_photos p where p.character_id = jiwoo and p.id = target_photo);
    when 'replace' then
      update private.live_call_photos p set image_base64 = new_image where p.character_id = jiwoo and p.id = target_photo;
      if not found then return null; end if;
      return private.live_photo_album_list(jiwoo);
    when 'delete' then
      delete from private.live_call_photos p where p.character_id = jiwoo and p.id = target_photo;
      if not found then return null; end if;
      return private.live_photo_album_list(jiwoo);
    else null;
  end case;
  if action not in ('add','edit') or jsonb_typeof(details->'tags') is distinct from 'array'
     or jsonb_array_length(details->'tags') not between 1 and 8
     or details->>'useFor' is null or details->>'days' is null then
    raise exception 'invalid photo details' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(details->'tags') tag
             where jsonb_typeof(tag) <> 'string' or char_length(btrim(tag #>> '{}')) not between 1 and 20) then
    raise exception 'invalid photo tag' using errcode = '22023';
  end if;
  select array_agg(btrim(tag) order by position) into new_tags
  from jsonb_array_elements_text(details->'tags') with ordinality items(tag, position);
  if action = 'add' then
    perform 1 from public.live_characters c where c.id = jiwoo for no key update;
    if not found then return null; end if;
    if exists (select 1 from private.live_call_photos p where p.character_id = jiwoo and p.id = target_photo) then
      return private.live_photo_album_list(jiwoo);
    end if;
    select n into next_slot from generate_series(1, 250) n
      where not exists (select 1 from private.live_call_photos p where p.character_id = jiwoo and p.slot = n)
      order by n limit 1;
    if next_slot is null then return null; end if;
    insert into private.live_call_photos(id,character_id,slot,situation,image_base64,tags,use_for,start_time,end_time,days)
      values(coalesce(target_photo,gen_random_uuid()),jiwoo,next_slot,btrim(new_situation),new_image,new_tags,details->>'useFor',
        coalesce(details->>'startTime',''),coalesce(details->>'endTime',''),details->>'days');
  else
    update private.live_call_photos p set situation = btrim(new_situation), tags = new_tags, use_for = details->>'useFor',
      start_time = coalesce(details->>'startTime',''), end_time = coalesce(details->>'endTime',''), days = details->>'days'
    where p.character_id = jiwoo and p.id = target_photo;
    if not found then return null; end if;
  end if;
  return private.live_photo_album_list(jiwoo);
end $$;
revoke all on function public.live_jiwoo_photo_album_edit(text,text,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.live_jiwoo_photo_album_edit(text,text,uuid,text,text,jsonb) to anon;

create function private.live_jiwoo_album_message(target_character uuid, photo text, msg jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare image text;
begin
  if target_character <> '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c' or photo is null then return msg; end if;
  if photo ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select p.image_base64 into image from private.live_call_photos p
    where p.character_id = target_character and p.id = photo::uuid and p.use_for in ('chat','both');
  end if;
  if image is null then
    return jsonb_set(msg, '{content}', to_jsonb('지금 그 사진은 앨범에서 꺼내기 어렵네.'::text));
  end if;
  return msg || jsonb_build_object('albumPhotoId', photo, 'image',
    jsonb_build_object('mimeType','image/jpeg','dataUrl','data:image/jpeg;base64,' || image));
end $$;
revoke all on function private.live_jiwoo_album_message(uuid,text,jsonb) from public, anon, authenticated;

-- Snapshot before the existing history/media write. Published messages retain their photo when the album is edited.
do $patch$
declare
  definition text;
  save_message constant text := 'perform public.live_sync_history(server_token,''append'',j.character_id,j.epoch,jsonb_build_array(msg));';
begin
  select pg_get_functiondef('public.live_reply_work(text,text,uuid,uuid,jsonb)'::regprocedure) into definition;
  if (length(definition) - length(replace(definition, save_message, ''))) <> length(save_message) then
    raise exception 'unexpected live reply worker definition';
  end if;
  execute replace(definition, save_message,
    'msg := private.live_jiwoo_album_message(j.character_id, j.result->>''albumPhotoId'', msg);' || E'\n    ' || save_message);
end $patch$;
notify pgrst, 'reload schema';
