do $patch$ declare definition text;begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 definition=replace(definition,'to_jsonb(claimed)||jsonb_build_object(''keys'',p.keys)','to_jsonb(claimed)||jsonb_build_object(''keys'',p.keys,''payload'',claimed.payload||jsonb_build_object(''unreadCount'',greatest(1,(select count(*) from private.live_message_events ev join private.live_companion_state st on st.character_id=ev.character_id where ev.message->>''role''=''assistant'' and (ev.message->>''ts'')::numeric>extract(epoch from st.seen_at)*1000))))');
 execute definition;
end $patch$;
notify pgrst,'reload schema';
