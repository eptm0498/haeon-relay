-- All fixtures, capability changes, history, push jobs and HTTP jobs roll back.
begin;
do $test$
declare token text='message-session-transaction-fixture'; fixture_id uuid=gen_random_uuid();
 session_id uuid=gen_random_uuid(); replacement uuid; claim jsonb; next_claim jsonb; result jsonb;
 session_row private.live_message_sessions%rowtype; h private.live_chat_history%rowtype; i integer; epoch_before uuid;
begin
 update private.live_history_key set key_hash=encode(extensions.digest(token,'sha256'),'hex');
 insert into public.live_characters(id,name,prompt,voice_id) values(fixture_id,'예약 검증 fixture',repeat('테스트용 캐릭터 ',12),'fixture-voice');
 begin
  perform public.live_message_session_work('invalid','start',fixture_id,'{}');
  raise exception 'missing capability accepted';
 exception when sqlstate '28000' then null;end;
 if has_table_privilege('anon','private.live_message_sessions','SELECT') or has_function_privilege('anon','private.live_message_session_tick()','EXECUTE') then raise exception 'private access leaked';end if;
 result=public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',session_id,'minutes',30,'count',30));
 select * into session_row from private.live_message_sessions where character_id=fixture_id;
 if cardinality(session_row.schedule)<>30 or session_row.schedule[1]<=session_row.started_at or session_row.schedule[30]>=session_row.ends_at then raise exception 'invalid schedule bounds';end if;
 for i in 2..30 loop if session_row.schedule[i]<=session_row.schedule[i-1] then raise exception 'schedule is not ordered';end if;end loop;
 result=public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',session_id,'minutes',30,'count',30));
 if (result->>'startedAt')::numeric<>extract(epoch from session_row.started_at)*1000 then raise exception 'duplicate start reset schedule';end if;
 begin
  perform public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',gen_random_uuid(),'minutes',30,'count',30));
  raise exception 'active session was replaced';
 exception when sqlstate 'PT409' then null;end;
 begin
  perform public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',gen_random_uuid(),'minutes',1,'count',3));
  raise exception 'excessive rate accepted';
 exception when sqlstate '22023' then null;end;
 perform public.live_message_session_work(token,'stop',fixture_id,jsonb_build_object('sessionId',session_id));
 session_id=gen_random_uuid();
 perform public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',session_id,'minutes',2,'count',3));
 update private.live_message_sessions set schedule=array_fill(now()-interval '1 second',array[3]),next_attempt_at=now()-interval '1 second' where character_id=fixture_id;
 if private.live_message_session_tick() is null then raise exception 'server wakeup unavailable';end if;
 claim=public.live_message_session_work(token,'claim',fixture_id);
 if claim is null or public.live_message_session_work(token,'claim',fixture_id) is not null then raise exception 'lease does not exclude duplicate worker';end if;
 select * into h from private.live_chat_history where character_id=fixture_id;
 perform public.live_sync_history(token,'append',fixture_id,h.epoch,jsonb_build_array(jsonb_build_object('id','fixture-user','role','user','content','강아지 이름은 코코야','ts',floor(extract(epoch from clock_timestamp())*1000))));
 result=public.live_message_session_work(token,'commit',fixture_id,jsonb_build_object('text','오래된 문맥'),(claim->>'lease')::uuid);
 if result is not null or (select sent from private.live_message_sessions where character_id=fixture_id)<>0 then raise exception 'stale context consumed a slot';end if;
 claim=public.live_message_session_work(token,'claim',fixture_id);
 if claim->'messages'->-1->>'content'<>'강아지 이름은 코코야' then raise exception 'new reply absent from claim context';end if;
 begin
  perform public.live_message_session_work(token,'commit',fixture_id,jsonb_build_object('text',repeat('가',81)),(claim->>'lease')::uuid);
  raise exception 'long message accepted';
 exception when sqlstate '22023' then null;end;
 result=public.live_message_session_work(token,'commit',fixture_id,jsonb_build_object('text','코코랑 산책 중이구나.'),(claim->>'lease')::uuid);
 if result is null then raise exception 'fresh commit failed';end if;
 result=public.live_message_session_work(token,'commit',fixture_id,jsonb_build_object('text','중복 발송'),(claim->>'lease')::uuid);
 if result is not null or (select sent from private.live_message_sessions where character_id=fixture_id)<>1 then raise exception 'duplicate commit consumed quota';end if;
 claim=public.live_message_session_work(token,'claim',fixture_id);
 perform public.live_message_session_work(token,'stop',fixture_id,jsonb_build_object('sessionId',gen_random_uuid()));
 if (select status from private.live_message_sessions where character_id=fixture_id)<>'active' then raise exception 'stale stop cancelled new session';end if;
 perform public.live_message_session_work(token,'stop',fixture_id,jsonb_build_object('sessionId',session_id));
 if public.live_message_session_work(token,'commit',fixture_id,jsonb_build_object('text','중단 후 발송'),(claim->>'lease')::uuid) is not null then raise exception 'stopped session committed';end if;
 replacement=gen_random_uuid();session_id=replacement;
 perform public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',session_id,'minutes',2,'count',3));
 update private.live_message_sessions set schedule=array_fill(now()-interval '1 second',array[3]) where character_id=fixture_id;
 for i in 1..3 loop
  next_claim=public.live_message_session_work(token,'claim',fixture_id);
  if next_claim is null then raise exception 'unanswered messages unexpectedly stopped';end if;
  result=public.live_message_session_work(token,'commit',fixture_id,jsonb_build_object('text','짧은 테스트 선톡 '||i),(next_claim->>'lease')::uuid);
  if result is null then raise exception 'quota commit failed';end if;
 end loop;
 select * into session_row from private.live_message_sessions where character_id=fixture_id;
 if session_row.sent<>3 or session_row.status<>'completed' or public.live_message_session_work(token,'claim',fixture_id) is not null then raise exception 'exact quota did not terminate';end if;
 if (select count(*) from private.live_message_events where character_id=fixture_id and message_id like 'session:'||session_id||':%')<>3 then raise exception 'history count mismatch';end if;
 result=public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',session_id,'minutes',2,'count',3));
 if result->>'status'<>'completed' then raise exception 'retried completed start restarted';end if;
 session_id=gen_random_uuid();
 perform public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',session_id,'minutes',1,'count',1));
 update private.live_message_sessions set schedule=array[now()-interval '1 second'] where character_id=fixture_id;
 claim=public.live_message_session_work(token,'claim',fixture_id);
 select epoch into epoch_before from private.live_chat_history where character_id=fixture_id;
 perform public.live_sync_history(token,'reset',fixture_id,epoch_before,'[]');
 if (select status from private.live_message_sessions where character_id=fixture_id)<>'stopped' or public.live_message_session_work(token,'commit',fixture_id,jsonb_build_object('text','초기화 후 발송'),(claim->>'lease')::uuid) is not null then raise exception 'reset left session active';end if;
 session_id=gen_random_uuid();
 perform public.live_message_session_work(token,'start',fixture_id,jsonb_build_object('sessionId',session_id,'minutes',1,'count',1));
 update private.live_message_sessions set started_at=now()-interval '2 minutes',ends_at=now()-interval '1 minute',schedule=array[now()-interval '2 minutes'] where character_id=fixture_id;
 if public.live_message_session_work(token,'claim',fixture_id) is not null or private.live_message_session_status(fixture_id)->>'status'<>'expired' then raise exception 'deadline not enforced';end if;
 perform private.live_message_session_tick();
 if (select status from private.live_message_sessions where character_id=fixture_id)<>'expired' then raise exception 'expired status not persisted';end if;
 if not exists(select 1 from cron.job where jobname='live-message-sessions' and active and schedule='10 seconds') then raise exception 'cron absent';end if;
end $test$;
rollback;
