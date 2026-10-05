do $patch$ declare definition text;begin
 definition=pg_get_functiondef('public.live_reply_work(text,text,uuid,uuid,jsonb)'::regprocedure);
 definition=replace(definition,' if action=''enqueue'' then', $body$
 if action='voice_activity' then
  select * into h from private.live_chat_history where character_id=target_character for update;
  if not found or exists(select 1 from private.live_reply_jobs where id=target_job) then return null;end if;
  select message into latest from private.live_message_events where character_id=target_character and epoch=h.epoch and message->>'role'='user' order by seq desc limit 1;
  if latest->>'id' is distinct from target_job::text then return null;end if;
  away=greatest(0,least(43200,(data->>'awaySeconds')::int));
  if away<1 then return null;end if;
  update private.live_reply_jobs set status='cancelled',payload='{}',result=null where character_id=target_character and kind='return' and status in ('queued','generating','ready');
  insert into private.live_activity(character_id,epoch,reason,until_at) values(target_character,h.epoch,left(coalesce(data->>'activity',''),160),clock_timestamp()+make_interval(secs=>away)) on conflict(character_id) do update set epoch=excluded.epoch,reason=excluded.reason,until_at=excluded.until_at,started_at=now();
  insert into private.live_reply_jobs(id,character_id,epoch,kind,due_at) values(target_job,target_character,h.epoch,'return',clock_timestamp()+make_interval(secs=>away));
  return jsonb_build_object('scheduled',true);
 end if;
 if action='enqueue' then$body$);
 execute definition;
end $patch$;
notify pgrst,'reload schema';
