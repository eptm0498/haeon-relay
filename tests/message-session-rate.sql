-- Every test change, including the temporary capability hash, is rolled back
-- inside a subtransaction. No real chat, notification or credential is changed.
do $test$
declare target uuid=gen_random_uuid(); session_id uuid=gen_random_uuid(); token text=gen_random_uuid()::text;
 claim jsonb; result jsonb; epoch uuid; drafts jsonb; n integer;
begin
 begin
  update private.live_history_key set key_hash=encode(extensions.digest(token,'sha256'),'hex');
  insert into public.live_characters(id,name,prompt,voice_id) values(target,'Session verification',repeat('A test adult character. ',6),'test-voice');
  begin
   perform public.live_message_session_work(token,'start',target,jsonb_build_object('minutes',1,'count',61,'sessionId',session_id));
   raise exception 'accepted 61 messages in one minute';
  exception when sqlstate '22023' then null;end;
  result=public.live_message_session_work(token,'start',target,jsonb_build_object('minutes',1,'count',60,'sessionId',session_id));
  if (result->>'total')::integer<>60 then raise exception '60/minute rejected';end if;
  if not exists(select 1 from private.live_message_sessions where character_id=target and cardinality(schedule)=60
   and schedule[1]>started_at and schedule[60]<ends_at and schedule=array(select unnest(schedule) order by 1)) then raise exception 'invalid randomized schedule';end if;
  select h.epoch into epoch from private.live_chat_history h where character_id=target;
  claim=public.live_message_session_work(token,'claim',target);
  if (claim->>'batchCount')::integer<>30 then raise exception 'batch prefill missing';end if;
  if public.live_message_session_work(token,'claim',target) is not null then raise exception 'duplicate claim';end if;
  select jsonb_agg('첫 번째 톡 '||i order by i) into drafts from generate_series(1,30) i;
  perform public.live_message_session_work(token,'commit',target,jsonb_build_object('texts',drafts),(claim->>'lease')::uuid);
  if (select sent from private.live_message_sessions where character_id=target)<>0 then raise exception 'sent before due';end if;
  update private.live_message_sessions set schedule=array(select clock_timestamp()-interval '1 second' from generate_series(1,60)) where character_id=target;
  n=private.live_deliver_message_session(target);
  if n<>30 then raise exception 'did not deliver first 30';end if;
  claim=public.live_message_session_work(token,'claim',target);
  select jsonb_agg('두 번째 톡 '||i order by i) into drafts from generate_series(1,30) i;
  perform public.live_message_session_work(token,'commit',target,jsonb_build_object('texts',drafts),(claim->>'lease')::uuid);
  if not exists(select 1 from private.live_message_sessions where character_id=target and sent=60 and status='completed') then raise exception '60 delivery incomplete';end if;
  if (select count(*) from private.live_message_events where character_id=target)<>60 then raise exception 'archive missing messages';end if;
  if private.live_deliver_message_session(target)<>0 then raise exception 'exceeded authorized total';end if;

  session_id=gen_random_uuid();
  perform public.live_message_session_work(token,'start',target,jsonb_build_object('minutes',1,'count',60,'sessionId',session_id));
  claim=public.live_message_session_work(token,'claim',target);
  perform public.live_message_session_work(token,'commit',target,jsonb_build_object('texts',drafts),(claim->>'lease')::uuid);
  -- Keep a small queue while the next batch is generated. Delivery of our own
  -- already prepared messages must not invalidate that generation.
  update private.live_message_sessions set schedule=array(select case when i<=22 then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '5 seconds' end from generate_series(1,60) i) where character_id=target;
  if private.live_deliver_message_session(target)<>22 then raise exception 'partial delivery wrong';end if;
  claim=public.live_message_session_work(token,'claim',target);
  update private.live_message_sessions set schedule=array(select clock_timestamp()-interval '1 second' from generate_series(1,60)) where character_id=target;
  if private.live_deliver_message_session(target)<>8 then raise exception 'own queued delivery wrong';end if;
  select jsonb_agg('이어지는 톡 '||i order by i) into drafts from generate_series(1,30) i;
  result=public.live_message_session_work(token,'commit',target,jsonb_build_object('texts',drafts),(claim->>'lease')::uuid);
  if result is null or (select sent from private.live_message_sessions where character_id=target)<>60 then raise exception 'own delivery invalidated generation';end if;

  session_id=gen_random_uuid();
  perform public.live_message_session_work(token,'start',target,jsonb_build_object('minutes',1,'count',60,'sessionId',session_id));
  claim=public.live_message_session_work(token,'claim',target);
  perform public.live_sync_history(token,'append',target,epoch,jsonb_build_array(jsonb_build_object('id','test-correction','role','user','content','새 답장 반영해','ts',extract(epoch from clock_timestamp())*1000)));
  if public.live_message_session_work(token,'commit',target,jsonb_build_object('texts',drafts),(claim->>'lease')::uuid) is not null then raise exception 'stale generation published';end if;
  claim=public.live_message_session_work(token,'claim',target);
  if claim->'messages'->-1->>'content'<>'새 답장 반영해' then raise exception 'fresh context missing';end if;
  perform public.live_message_session_work(token,'commit',target,jsonb_build_object('texts',drafts),(claim->>'lease')::uuid);
  perform public.live_sync_history(token,'append',target,epoch,jsonb_build_array(jsonb_build_object('id','test-correction-2','role','user','content','다시 정정해','ts',extract(epoch from clock_timestamp())*1000+100)));
  update private.live_message_sessions set schedule=array(select clock_timestamp()-interval '1 second' from generate_series(1,60)) where character_id=target;
  n=private.live_deliver_message_session(target);
  if n<>0 or (select cardinality(s.drafts) from private.live_message_sessions s where character_id=target)<>0 then raise exception 'stale queue delivered';end if;
  claim=public.live_message_session_work(token,'claim',target);
  perform public.live_message_session_work(token,'stop',target,jsonb_build_object('sessionId',session_id));
  if public.live_message_session_work(token,'commit',target,jsonb_build_object('texts',drafts),(claim->>'lease')::uuid) is not null then raise exception 'published after stop';end if;
  if private.live_deliver_message_session(target)<>0 then raise exception 'delivered after stop';end if;

  perform public.live_message_session_work(token,'start',target,jsonb_build_object('minutes',180,'count',10800,'sessionId',gen_random_uuid()));
  if (select total from private.live_message_sessions where character_id=target)<>10800 then raise exception 'long high-rate session rejected';end if;
  raise exception using errcode='PT777',message='tests succeeded; rollback fixtures';
 exception when sqlstate 'PT777' then null;end;
 if exists(select 1 from public.live_characters where id=target) then raise exception 'fixture rollback failed';end if;
end $test$;
select 'LIVE_MESSAGE_SESSION_SQL_OK' as verification;
