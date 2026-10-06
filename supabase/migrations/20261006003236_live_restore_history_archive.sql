-- History reads INSERT ... ON CONFLICT DO NOTHING. BEFORE INSERT still runs
-- on conflicts: never let that initialization attempt erase an existing archive.
do $migration$
declare definition text;
begin
 definition=pg_get_functiondef('private.live_archive_history()'::regprocedure);
 if position('existing history initialization' in definition)=0 then
  definition=replace(definition,'begin',E'begin\n -- existing history initialization\n if tg_op=''INSERT'' and exists(select 1 from private.live_chat_history where character_id=new.character_id) then return new;end if;');
  execute definition;
 end if;
end;
$migration$;

-- Restore only retained messages, using the original counter/sequence positions.
-- Keep conversation epochs, full messages, media and existing memory untouched.
insert into private.live_message_events(character_id,epoch,seq,message_id,message)
select h.character_id,h.epoch,
 greatest(h.message_count,jsonb_array_length(h.messages))-jsonb_array_length(h.messages)+m.ordinality,
 m.item->>'id', (m.item-'image') || jsonb_build_object('content',coalesce(nullif(m.item->>'content',''),case when m.item ? 'image' then '[사진] '||coalesce(m.item->>'imagePrompt','') else '' end))
from private.live_chat_history h
cross join lateral jsonb_array_elements(h.messages) with ordinality as m(item,ordinality)
where not exists(select 1 from private.live_message_events e where e.character_id=h.character_id and e.epoch=h.epoch)
on conflict do nothing;
notify pgrst,'reload schema';
