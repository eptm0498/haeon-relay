-- Matches the version recorded when applied to the production database.
-- Keep the RPC signature unchanged while resolving the parameter/column name
-- collision in ON CONFLICT. Editor authorization and duplicate protection stay intact.
CREATE OR REPLACE FUNCTION public.live_import_samples(edit_token text, character_id uuid, samples jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare inserted integer;
begin
  if not private.live_editor_ok(edit_token) then raise exception 'invalid editor link' using errcode='28000'; end if;
  if not exists(select 1 from public.live_characters c where c.id=$2) then raise exception 'character not found' using errcode='22023'; end if;
  if jsonb_typeof(samples)<>'array' or jsonb_array_length(samples)>400 then raise exception 'invalid sample batch' using errcode='22023'; end if;
  insert into private.live_dialogue_samples(character_id,source_hash,cue,reply,spoken,category,quality,enabled)
  select $2,x->>'source_hash',x->>'cue',x->>'reply',x->>'spoken',x->>'category',(x->>'quality')::integer,coalesce((x->>'enabled')::boolean,false)
  from jsonb_array_elements(samples) x
  where (x->>'source_hash') ~ '^[a-f0-9]{64}$'
    and char_length(x->>'cue') between 2 and 700 and char_length(x->>'reply') between 1 and 900 and char_length(x->>'spoken') between 1 and 900
    and x->>'category' in ('일상','장난','애정','위로','갈등','생각','잠/생활','기타')
    and (x->>'quality')::integer between 0 and 100
  on conflict(character_id,source_hash) where source_hash is not null do nothing;
  get diagnostics inserted=row_count;
  return inserted;
end;
$function$;
