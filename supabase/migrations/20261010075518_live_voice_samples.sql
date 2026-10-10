-- The web server's existing capability is required; editor enable/disable choices
-- remain authoritative. No archive contents are stored in this migration.
create index if not exists live_dialogue_samples_voice_idx
 on private.live_dialogue_samples(character_id,category) where enabled;

create or replace function public.live_voice_samples(
 server_token text, target_character uuid, query_terms text[], preferred_category text, variation text
)
returns table(id uuid,cue text,reply text,spoken text,category text,quality integer)
language plpgsql stable security definer set search_path='' as $function$
begin
 if not coalesce(private.live_server_ok(server_token),false) then
  raise exception 'invalid server capability' using errcode='28000';
 end if;
 if target_character is null or query_terms is null or cardinality(query_terms)>12
  or exists(select 1 from unnest(query_terms) t where t is null or length(t) not between 1 and 20)
  or preferred_category is null or preferred_category not in ('일상','장난','애정','위로','갈등','생각','잠/생활','기타')
  or variation is null or length(variation)>128 then
  raise exception 'invalid voice query' using errcode='22023';
 end if;
 return query
  with candidates as (
   select s.*, (select count(*) from unnest(query_terms) t
     where position(lower(t) in lower(replace(s.cue,' ','')))>0) as matches
   from private.live_dialogue_samples s
   where s.character_id=target_character and s.enabled
    and length(s.cue)<=400 and length(s.reply)<=450 and length(s.spoken)<=450
  ), ranked as (
   select s.*,row_number() over(partition by s.category
    order by s.matches desc,md5(s.id::text||variation),s.quality desc) as rn
   from candidates s
  )
  select s.id,s.cue,s.reply,s.spoken,s.category,s.quality from ranked s
  where s.rn<=16
  order by s.matches desc,case when s.category=preferred_category then 0 else 1 end,s.rn,s.id
  limit 128;
end;
$function$;
revoke all on function public.live_voice_samples(text,uuid,text[],text,text) from public;
grant execute on function public.live_voice_samples(text,uuid,text[],text,text) to anon,authenticated,service_role;
comment on function public.live_voice_samples(text,uuid,text[],text,text) is
 'Server-capability gated, character-isolated, enabled-only archive examples with topic and category diversity.';
