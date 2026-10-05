-- Avoid a SQL alias colliding with the PL/pgSQL history record named h.
do $fix$
declare definition text; original text='(select coalesce(jsonb_agg(h.character_id),''[]'') from private.live_chat_history h left join private.live_memory m on m.character_id=h.character_id where h.message_count-coalesce(m.covered_count,0)>=100)'; replacement text='(select coalesce(jsonb_agg(hist.character_id),''[]'') from private.live_chat_history hist left join private.live_memory memo on memo.character_id=hist.character_id where hist.message_count-coalesce(memo.covered_count,0)>=100)';
begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 if position(original in definition)=0 then raise exception 'expected worker query was not found'; end if;
 execute replace(definition,original,replacement);
end $fix$;
notify pgrst,'reload schema';
