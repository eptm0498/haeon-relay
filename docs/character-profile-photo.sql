CREATE OR REPLACE FUNCTION public.live_save_character(edit_token text, character_id uuid, character_name text, new_prompt text, new_voice_id text, new_voice_name text, new_avatar_url text, make_default boolean, new_sort_order integer, expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare row_value public.live_characters%rowtype;
declare current_version integer;
begin
  if not private.live_editor_ok(edit_token) then
    raise exception 'invalid editor link' using errcode='28000';
  end if;
  if character_name is null or char_length(trim(character_name)) not between 1 and 40
    or new_prompt is null or char_length(new_prompt) not between 100 and 30000
    or new_voice_id is null or char_length(new_voice_id) not between 8 and 100
    or char_length(coalesce(new_voice_name,'')) > 100
    or (char_length(coalesce(new_avatar_url,'')) > 2000 and (char_length(new_avatar_url) > 200000 or new_avatar_url !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'))
    or new_sort_order not between -1000 and 1000 then
    raise exception 'invalid character' using errcode='22023';
  end if;

  if $2 is null then
    if coalesce(make_default,false) then update public.live_characters c set is_default=false where c.is_default; end if;
    insert into public.live_characters(name,prompt,voice_id,voice_name,avatar_url,is_default,sort_order)
    values(trim(character_name),new_prompt,new_voice_id,coalesce(new_voice_name,''),nullif(trim(coalesce(new_avatar_url,'')),''),coalesce(make_default,false),new_sort_order)
    returning * into row_value;
  else
    select c.version into current_version from public.live_characters c where c.id=$2 for update;
    if current_version is null then raise exception 'character not found' using errcode='22023'; end if;
    if current_version is distinct from expected_version then
      raise exception 'settings changed elsewhere' using errcode='40001';
    end if;
    if coalesce(make_default,false) then update public.live_characters c set is_default=false where c.is_default and c.id<>$2; end if;
    update public.live_characters c
      set name=trim(character_name), prompt=new_prompt, voice_id=new_voice_id,
          voice_name=coalesce(new_voice_name,''), avatar_url=nullif(trim(coalesce(new_avatar_url,'')),''),
          is_default=coalesce(make_default,false), sort_order=new_sort_order,
          version=c.version+1, updated_at=now()
      where c.id=$2
      returning c.* into row_value;
  end if;

  if not exists(select 1 from public.live_characters c where c.is_default) then
    update public.live_characters c set is_default=true where c.id=row_value.id returning c.* into row_value;
  end if;

  return to_jsonb(row_value);
end;
$function$
;
