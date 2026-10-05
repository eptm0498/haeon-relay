create or replace function public.live_character_summaries(edit_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order,c.created_at,c.id),'[]'::jsonb) into result
 from public.live_characters c;
 return result;
end $$;
revoke all on function public.live_character_summaries(text) from public;
grant execute on function public.live_character_summaries(text) to anon,authenticated;

create or replace function public.live_editor_character_references(edit_token text,character_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
 select images into result from private.live_character_references r where r.character_id=live_editor_character_references.character_id;
 return coalesce(result,'{"face":[],"body":[]}'::jsonb);
end $$;
revoke all on function public.live_editor_character_references(text,uuid) from public;
grant execute on function public.live_editor_character_references(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
