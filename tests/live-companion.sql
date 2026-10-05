-- Run inside one rolled-back transaction, substituting the server capability in memory.
begin;
do $test$
declare tok text:=$cap$__SERVER_CAPABILITY__$cap$; cid uuid; ep uuid; batch jsonb; claimed jsonb; result jsonb; dev uuid:=gen_random_uuid();
begin
 if not private.live_server_ok(tok) then raise exception 'verification capability invalid'; end if;
 insert into public.live_characters(name,prompt,voice_id,voice_name,is_default,sort_order) select '기능 검증',prompt,voice_id,voice_name,false,999 from public.live_characters limit 1 returning id into cid;
 insert into private.live_chat_history(character_id) values(cid) returning epoch into ep;
 for start_at in 0..4 loop
  select jsonb_agg(jsonb_build_object('id','test-'||i,'role',case when i%2=0 then 'assistant' else 'user' end,'content','메시지 '||i,'ts',floor(extract(epoch from now()-interval '2 hours')*1000)+i)) into batch from generate_series(start_at*20+1,start_at*20+20) i;
  perform public.live_sync_history(tok,'append',cid,ep,batch);
 end loop;
 if (select message_count from private.live_chat_history where character_id=cid)<>100 then raise exception '100-message count failed'; end if;
 perform public.live_sync_history(tok,'append',cid,ep,batch);
 if (select message_count from private.live_chat_history where character_id=cid)<>100 then raise exception 'dedup count failed'; end if;
 result=public.live_companion_work(tok,'memory_due');
 if not (result @> jsonb_build_array(cid)) then raise exception 'worker did not find due memory'; end if;
 claimed=public.live_memory_work(tok,'claim',cid);
 if jsonb_array_length(claimed->'messages')<>100 or (claimed->>'claimed_count')::int<>100 then raise exception 'summary threshold failed'; end if;
 if public.live_memory_work(tok,'claim',cid) is not null then raise exception 'duplicate lease accepted'; end if;
 perform public.live_memory_work(tok,'commit',cid,ep,(claimed->>'lease')::uuid,'누적 기억 검증');
 result=public.live_memory_work(tok,'read',cid);
 if result->>'summary'<>'누적 기억 검증' or (result->>'covered_count')::int<>100 then raise exception 'summary persistence failed'; end if;
 for start_at in 0..24 loop
  select jsonb_agg(jsonb_build_object('id','overflow-'||i,'role',case when i%2=0 then 'assistant' else 'user' end,'content','확장 메시지 '||i,'ts',floor(extract(epoch from now()-interval '1 hour')*1000)+i)) into batch from generate_series(start_at*40+1,start_at*40+40) i;
  perform public.live_sync_history(tok,'append',cid,ep,batch);
 end loop;
 if (select jsonb_array_length(messages) from private.live_chat_history where character_id=cid)<>1000 or (select count(*) from private.live_message_events where character_id=cid)<>1100 then raise exception 'archive lost messages beyond display window'; end if;
 perform public.live_sync_history(tok,'reset',cid,ep,'[]');
 select epoch into ep from private.live_chat_history where character_id=cid;
 result=public.live_memory_work(tok,'read',cid);
 if result->>'summary'<>'' or (result->>'message_count')::int<>0 then raise exception 'reset leaked old memory'; end if;
 perform public.live_sync_history(tok,'append',cid,ep,jsonb_build_array(jsonb_build_object('id','idle-user','role','user','content','오늘은 일 마치고 쉬고 있어.','ts',floor(extract(epoch from now()-interval '2 hours')*1000))));
 perform public.live_companion_work(tok,'status',null,dev);
 update private.live_companion_state set enabled=false where character_id<>cid;
 perform public.live_companion_work(tok,'presence',cid,dev,'{"visible":true,"busy":false}');
 if public.live_companion_work(tok,'claim') is not null then raise exception 'active chat received proactive'; end if;
 perform public.live_companion_work(tok,'presence',null,dev,'{"visible":false,"busy":false}');
 if extract(hour from now() at time zone 'Asia/Seoul') not between 1 and 7 then
  claimed=public.live_companion_work(tok,'claim');
  if claimed is null or claimed->'character'->>'id'<>cid::text then raise exception 'proactive candidate missing'; end if;
  result=public.live_companion_work(tok,'commit',cid,null,'{"text":"쉬고 있어? 잠깐 생각나서."}',(claimed->>'lease')::uuid);
  if result is null or result->>'proactive'<>'true' then raise exception 'proactive commit failed'; end if;
  if public.live_companion_work(tok,'commit',cid,null,'{"text":"중복"}',(claimed->>'lease')::uuid) is not null then raise exception 'proactive duplicate accepted'; end if;
 end if;
end $test$;
rollback;
