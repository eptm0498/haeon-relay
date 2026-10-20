-- Full character memory editing uses the existing private editor capability.
-- Source transcripts and their hashes remain immutable through the editor.
alter table private.live_story_archive add column if not exists chat_prompt text;
alter table private.live_story_archive add column if not exists voice_prompt text;

create or replace function private.live_story_settings_valid(story jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb; key text;
begin
 if jsonb_typeof(story) is distinct from 'object' or length(story::text)>1800000 then return false; end if;
 foreach key in array array['instructions','current_state','style_guide','chat_prompt','voice_prompt'] loop
  if jsonb_typeof(story->key) is distinct from 'string' or length(story->>key)>60000 then return false; end if;
 end loop;
 if jsonb_typeof(story->'chapters') is distinct from 'array' or jsonb_typeof(story->'examples') is distinct from 'array' or jsonb_typeof(story->'memory_excerpts') is distinct from 'array' then return false; end if;
 if jsonb_array_length(story->'chapters')>100 or jsonb_array_length(story->'examples')>1000 or jsonb_array_length(story->'memory_excerpts')>1500 then return false; end if;
 for item in select value from jsonb_array_elements(story->'chapters') loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id')>100 or jsonb_typeof(item->'title') is distinct from 'string' or length(item->>'title')>200 or jsonb_typeof(item->'facts') is distinct from 'string' or length(item->>'facts')>20000 then return false; end if;
  foreach key in array array['terms','sourceIds'] loop
   if jsonb_typeof(item->key) is distinct from 'array' then return false; end if;
   if jsonb_array_length(item->key)>100 or exists(select 1 from jsonb_array_elements(item->key) x(value) where jsonb_typeof(x.value) is distinct from 'string' or length(x.value#>>'{}')>(case when key='terms' then 100 else 200 end)) then return false; end if;
  end loop;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(story->'chapters'))<>jsonb_array_length(story->'chapters') then return false; end if;
 for item in select value from jsonb_array_elements(story->'examples') loop
  foreach key in array array['cue','reply','spoken','sourceId'] loop
   if jsonb_typeof(item->key) is distinct from 'string' or length(item->>key)>(case when key='cue' then 2000 when key='sourceId' then 200 else 10000 end) then return false; end if;
  end loop;
 end loop;
 for item in select value from jsonb_array_elements(story->'memory_excerpts') loop
  if jsonb_typeof(item->'seq') is distinct from 'number' or (item->>'seq')!~'^[0-9]{1,7}$' then return false; end if;
  if (item->>'seq')::integer>1000000 or jsonb_typeof(item->'sourceId') is distinct from 'string' or length(item->>'sourceId')>200 or jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'text')>15000 then return false; end if;
 end loop;
 return true;
end; $$;
revoke all on function private.live_story_settings_valid(jsonb) from public,anon,authenticated;

create or replace function public.live_editor_story(edit_token text,target_character uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
 select jsonb_build_object('source_title',a.source_title,'source_url',a.source_url,'captured_at',a.captured_at,'message_count',a.message_count,
  'instructions',a.instructions,'current_state',a.current_state,'style_guide',a.style_guide,'chat_prompt',a.chat_prompt,'voice_prompt',a.voice_prompt,
  'chapters',a.chapters,'examples',a.examples,'memory_excerpts',a.memory_excerpts)
 into result from private.live_story_archive a where a.character_id=target_character and a.complete;
 return result;
end; $$;
revoke all on function public.live_editor_story(text,uuid) from public,authenticated;
grant execute on function public.live_editor_story(text,uuid) to anon;

create or replace function public.live_editor_story_source(edit_token text,target_character uuid,page_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
 if page_offset<0 or page_offset>1000000 then raise exception 'invalid page' using errcode='22023'; end if;
 select jsonb_build_object('instructions',a.source_instructions,'total',jsonb_array_length(a.source_messages),'offset',page_offset,
  'messages',(select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) from jsonb_array_elements(a.source_messages) with ordinality m(item,ordinal) where ordinal>page_offset and ordinal<=page_offset+20))
 into result from private.live_story_archive a where a.character_id=target_character and a.complete;
 return result;
end; $$;
revoke all on function public.live_editor_story_source(text,uuid,integer) from public,authenticated;
grant execute on function public.live_editor_story_source(text,uuid,integer) to anon;

create or replace function public.live_save_character_with_story(edit_token text,character_data jsonb,story jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb; target uuid;
begin
 if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
 if not private.live_story_settings_valid(story) then raise exception 'invalid story settings' using errcode='22023'; end if;
 target=(character_data->>'id')::uuid;
 if target is null or not exists(select 1 from private.live_story_archive a where a.character_id=target and a.complete) then raise exception 'story not found' using errcode='22023'; end if;
 -- The existing character lock/version check covers both profile and memory.
 -- Any later failure rolls back the character, references and story together.
 saved=public.live_save_character_with_references(edit_token,target,character_data->>'name',character_data->>'prompt',character_data->>'voice_id',character_data->>'voice_name',character_data->>'avatar_url',
  (character_data->>'is_default')::boolean,(character_data->>'sort_order')::integer,(character_data->>'version')::integer,character_data->'reference_images');
 update private.live_story_archive a set instructions=story->>'instructions',current_state=story->>'current_state',style_guide=story->>'style_guide',
  chat_prompt=story->>'chat_prompt',voice_prompt=story->>'voice_prompt',chapters=story->'chapters',examples=story->'examples',memory_excerpts=story->'memory_excerpts'
 where a.character_id=target;
 return saved||jsonb_build_object('story',public.live_editor_story(edit_token,target));
end; $$;
revoke all on function public.live_save_character_with_story(text,jsonb,jsonb) from public,authenticated;
grant execute on function public.live_save_character_with_story(text,jsonb,jsonb) to anon;
