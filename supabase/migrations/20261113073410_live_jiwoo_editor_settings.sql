create table private.live_jiwoo_preferences (
  singleton boolean primary key default true check (singleton),
  settings jsonb not null,
  version integer not null default 0
);
alter table private.live_jiwoo_preferences enable row level security;
revoke all on private.live_jiwoo_preferences from public, anon, authenticated;
insert into private.live_jiwoo_preferences(settings) values
  ('{"chatPrompt":"","voicePrompt":"","workHours":["09:00-21:00","16:00-21:00","","16:00-21:00","","","09:00-21:00"],"scheduleNotes":"2026년 11월 23~27일 오전 하남중 시간강사 출강 예정."}');

create function public.live_jiwoo_preferences(access_token text, editor boolean, action text, settings jsonb default null, expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.live_jiwoo_preferences%rowtype;
begin
  if not coalesce(case when editor then private.live_editor_ok(access_token) else private.live_server_ok(access_token) end, false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if action = 'read' then
    select * into strict saved from private.live_jiwoo_preferences where singleton;
  elsif action = 'save' and editor then
    if jsonb_typeof(settings) is distinct from 'object'
      or jsonb_typeof(settings->'workHours') is distinct from 'array'
      or jsonb_array_length(settings->'workHours') <> 7
      or exists (
        select 1 from jsonb_array_elements(settings->'workHours') as hours(value)
        where jsonb_typeof(value) <> 'string'
          or ((value #>> '{}') <> '' and (
            (value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'
            or split_part(value #>> '{}', '-', 1) >= split_part(value #>> '{}', '-', 2)))
      )
      or jsonb_typeof(settings->'chatPrompt') is distinct from 'string' or char_length(settings->>'chatPrompt') > 8000
      or jsonb_typeof(settings->'voicePrompt') is distinct from 'string' or char_length(settings->>'voicePrompt') > 8000
      or jsonb_typeof(settings->'scheduleNotes') is distinct from 'string' or char_length(settings->>'scheduleNotes') > 2000 then
      raise exception 'invalid Jiwoo preferences' using errcode = '22023';
    end if;
    update private.live_jiwoo_preferences p set settings = live_jiwoo_preferences.settings, version = p.version + 1
      where singleton and p.version = expected_version returning * into saved;
    if not found then raise exception 'settings changed' using errcode = 'PT409'; end if;
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;
  return saved.settings || jsonb_build_object('version', saved.version);
end;
$$;
revoke all on function public.live_jiwoo_preferences(text,boolean,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.live_jiwoo_preferences(text,boolean,text,jsonb,integer) to anon;
create or replace function public.live_call_photos_edit(edit_token text, target_character uuid, action text,
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
      select n into next_slot from generate_series(1, case when target_character = '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid then 42 else 8 end) n
      where not exists (select 1 from private.live_call_photos p where p.character_id = target_character and p.slot = n)
      order by n limit 1;
      if next_slot is null then return null; end if;
      insert into private.live_call_photos(character_id,slot,situation,image_base64)
        values(target_character,next_slot,btrim(new_situation),new_image);
    when 'edit' then
      update private.live_call_photos p set situation = btrim(new_situation)
      where p.character_id = target_character and p.id = target_photo;
      if not found then return null; end if;
    when 'replace' then
      update private.live_call_photos p set image_base64 = new_image
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
notify pgrst, 'reload schema';
