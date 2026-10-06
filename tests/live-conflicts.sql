-- Run only with the configured server capability substituted in memory.
-- The fixture and all changes are rolled back; no real character is edited.
begin;
do $test$
declare tok text:=$cap$__SERVER_CAPABILITY__$cap$;cid uuid;ep uuid;failures integer:=0;
begin
 insert into public.live_characters(name,prompt,voice_id,voice_name,is_default,sort_order)
 select '충돌 회귀 검증',repeat('검증용 캐릭터 설정. ',20),voice_id,voice_name,false,999 from public.live_characters limit 1 returning id into cid;
 insert into private.live_chat_history(character_id) values(cid) returning epoch into ep;
 perform public.live_memory_work(tok,'read',cid);
 begin
  perform public.live_memory_work(tok,'commit',cid,ep,gen_random_uuid(),'저장되면 안 되는 기억');
  raise exception 'stale memory incorrectly accepted';
 exception when sqlstate 'PT409' then failures=failures+1;
 end;
 begin
  perform public.live_sync_history(tok,'append',cid,gen_random_uuid(),'[]');
  raise exception 'stale history incorrectly accepted';
 exception when sqlstate 'PT409' then failures=failures+1;
 end;
 if failures<>2 then raise exception 'conflict status mismatch';end if;
 if exists(select 1 from private.live_memory where character_id=cid and summary='저장되면 안 되는 기억') then raise exception 'conflict changed memory';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and (p.proname like 'live_%' or p.proname like 'dokyeong_%') and p.prosrc like '%40001%') then raise exception 'unsafe custom serialization error remains';end if;
end;
$test$;
rollback;
