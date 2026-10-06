begin;
do $test$
declare tok text:=$cap$__SERVER_CAPABILITY__$cap$;cid uuid;ep uuid;claim jsonb;
begin
 insert into public.live_characters(name,prompt,voice_id,voice_name,is_default,sort_order)
 select '보관 공백 회귀 검증',repeat('검증 설정. ',30),voice_id,voice_name,false,999 from public.live_characters limit 1 returning id into cid;
 insert into private.live_chat_history(character_id) values(cid) returning epoch into ep;
 perform public.live_sync_history(tok,'append',cid,ep,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'role','user','content','남아 있는 기록','ts',1)));
 update private.live_message_events set seq=201 where character_id=cid;
 update private.live_chat_history set message_count=201 where character_id=cid;
 claim=public.live_memory_work(tok,'claim',cid);
 if jsonb_array_length(claim->'messages')<>1 or (claim->>'claimed_count')::int<>201 then raise exception 'memory claimed empty missing archive range';end if;
 perform public.live_memory_work(tok,'commit',cid,ep,(claim->>'lease')::uuid,'복구한 기록의 기억');
 perform public.live_sync_history(tok,'read');
 if public.live_memory_work(tok,'claim',cid) is not null then raise exception 'processed archive reclaimed';end if;
 if not exists(select 1 from private.live_memory where character_id=cid and summary='복구한 기록의 기억' and covered_count=201) then raise exception 'memory lost on history read';end if;
end;
$test$;
rollback;
