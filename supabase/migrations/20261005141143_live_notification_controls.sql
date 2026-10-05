create function public.live_test_push(server_token text,device_id uuid,target_character uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;msg text:='test:'||gen_random_uuid();n integer;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid capability' using errcode='28000';end if;
 perform pg_advisory_xact_lock(hashtext(device_id::text));
 if not exists(select 1 from private.live_push_subscriptions s where s.device_id=live_test_push.device_id) then raise exception 'PUSH_NOT_SUBSCRIBED';end if;
 if exists(select 1 from private.live_push_jobs j join private.live_push_subscriptions s using(endpoint) where s.device_id=live_test_push.device_id and j.message_id like 'test:%' and j.next_attempt_at>now()-interval '1 minute') then raise exception 'PUSH_TEST_COOLDOWN';end if;
 select id into cid from public.live_characters where id=target_character or target_character is null order by is_default desc limit 1;
 insert into private.live_push_jobs(endpoint,message_id,payload) select endpoint,msg,jsonb_build_object('title','LIVE','body','알림 연결이 잘 되었어. 앱을 닫아도 새 메시지 알림을 받을 수 있어.','characterId',cid,'messageId',msg,'unreadCount',1) from private.live_push_subscriptions s where s.device_id=live_test_push.device_id;
 get diagnostics n=row_count;return jsonb_build_object('queued',n);
end $$;
revoke all on function public.live_test_push(text,uuid,uuid) from public;
grant execute on function public.live_test_push(text,uuid,uuid) to anon;
do $patch$
declare definition text;
begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 definition=replace(definition,'lease_until=now()+interval ''2 minutes''','lease_until=now()+interval ''5 minutes''');
 execute definition;
 definition=pg_get_functiondef('public.live_data_work(text,text,uuid,jsonb)'::regprocedure);
 definition=replace(definition,'and (action<>''search'' or ev.message->>''content'' ilike ''%''||left(coalesce(data->>''query'',''''),200)||''%'')','and (action<>''search'' or (ev.message->>''content'' ilike ''%''||left(coalesce(data->>''query'',''''),200)||''%'' and (coalesce(data->>''date'','''')='''' or (to_timestamp((ev.message->>''ts'')::numeric/1000) at time zone ''Asia/Seoul'')::date=(data->>''date'')::date)))');
 definition=replace(definition,'ev.message || case when med.message_id is not null','ev.message || case when med.message_id is not null and ev.message->>''role''=''assistant'' then ''{"content":""}''::jsonb else ''{}''::jsonb end || case when med.message_id is not null');
 execute definition;
 definition=pg_get_functiondef('public.live_image_work(text,text,uuid,uuid,jsonb)'::regprocedure);
 definition=replace(definition,'elsif action=''claim'' then','elsif action=''claim'' then update private.live_image_jobs set status=''failed'',error=''사진 생성이 중단됐어. 새 요청으로 다시 시도해 줘.'',lease=null,lease_until=null where status=''running'' and lease_until<now() and attempts>=3;');
 execute definition;
end $patch$;
notify pgrst,'reload schema';
