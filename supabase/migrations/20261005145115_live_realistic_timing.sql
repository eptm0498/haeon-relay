create table private.live_activity (
 character_id uuid primary key references public.live_characters(id) on delete cascade,
 epoch uuid not null, reason text not null, until_at timestamptz not null,started_at timestamptz not null default now()
);
create table private.live_reply_jobs (
 id uuid primary key,character_id uuid not null references public.live_characters(id) on delete cascade,
 epoch uuid not null,kind text not null default 'reply' check(kind in ('reply','return')),
 payload jsonb not null default '{}',result jsonb,status text not null default 'queued' check(status in ('queued','generating','ready','complete','failed','cancelled')),
 due_at timestamptz not null default now(),lease uuid,lease_until timestamptz,attempts integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table private.live_activity enable row level security;
alter table private.live_reply_jobs enable row level security;
revoke all on private.live_activity,private.live_reply_jobs from public,anon,authenticated;
create index live_reply_due on private.live_reply_jobs(due_at) where status in ('queued','generating','ready');
create index live_reply_character on private.live_reply_jobs(character_id,epoch);

create function public.live_reply_work(server_token text,action text,target_job uuid default null,target_character uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.live_chat_history%rowtype;j private.live_reply_jobs%rowtype;a private.live_activity%rowtype;
 msg jsonb;latest jsonb;recent jsonb;photos jsonb:='[]';characters jsonb:='[]';total integer:=0;away integer;delay integer;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid server capability' using errcode='28000';end if;
 if action='activity' then return (select jsonb_build_object('reason',reason,'until',until_at,'started',started_at) from private.live_activity where character_id=target_character);end if;
 if action='enqueue' then
  select * into h from private.live_chat_history where character_id=target_character for update;
  if not found then raise exception 'missing conversation';end if;
  if exists(select 1 from private.live_reply_jobs where id=target_job and character_id=target_character and epoch=h.epoch) then return jsonb_build_object('queued',true,'id',target_job);end if;
  select message into latest from private.live_message_events where character_id=target_character and epoch=h.epoch and message_id=target_job::text and message->>'role'='user';
  if latest is null then raise exception 'user message not saved';end if;
  update private.live_reply_jobs set status='cancelled',payload='{}',result=null,lease=null,lease_until=null,updated_at=now() where character_id=target_character and status in ('queued','generating','ready') and (kind='reply' or coalesce(data->>'urgent','false')<>'true');
  select * into a from private.live_activity where character_id=target_character and epoch=h.epoch;
  insert into private.live_reply_jobs(id,character_id,epoch,payload,due_at) values(target_job,target_character,h.epoch,data,case when a.until_at>now() and coalesce(data->>'urgent','false')<>'true' then a.until_at else now() end);
  return jsonb_build_object('queued',true,'id',target_job);
 end if;
 if action='claim' then
  -- Reset/deletion invalidates all work; leases allow recovery after a stopped worker.
  update private.live_reply_jobs jobs set status='cancelled',payload='{}',result=null,lease=null,lease_until=null where status in ('queued','generating','ready') and not exists(select 1 from private.live_chat_history hist where hist.character_id=jobs.character_id and hist.epoch=jobs.epoch);
  update private.live_reply_jobs set status='failed',payload='{}',lease=null,lease_until=null where status='generating' and lease_until<now() and attempts>=3;
  select * into j from private.live_reply_jobs where (target_job is null or id=target_job) and due_at<=now() and (status='queued' or status='generating' and lease_until<now() and attempts<3) order by due_at for update skip locked limit 1;
  if not found then return null;end if;
  update private.live_reply_jobs set status='generating',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() where id=j.id returning * into j;
  select * into h from private.live_chat_history where character_id=j.character_id;
  select jsonb_agg(message order by seq) into recent from (select seq,message from private.live_message_events where character_id=j.character_id and epoch=j.epoch order by seq desc limit 24) events;
  return to_jsonb(j)||jsonb_build_object('context',jsonb_build_object('messages',coalesce(recent,'[]'),'memory',(select summary from private.live_memory where character_id=j.character_id and epoch=j.epoch)),'activity',(select jsonb_build_object('reason',reason,'until',until_at) from private.live_activity where character_id=j.character_id and epoch=j.epoch));
 end if;
 if action in ('schedule','fail','skip') then
  select * into j from private.live_reply_jobs where id=target_job for update;
  if not found or j.status<>'generating' or j.lease::text is distinct from data->>'lease' then return null;end if;
  if action='skip' then update private.live_reply_jobs set status='complete',payload='{}',lease=null,lease_until=null where id=j.id;delete from private.live_activity where character_id=j.character_id and epoch=j.epoch and until_at<=now();return '{}';end if;
  if action='fail' then update private.live_reply_jobs set status=case when attempts<3 then 'queued' else 'failed' end,due_at=now()+interval '30 seconds',lease=null,lease_until=null,updated_at=now() where id=j.id;return '{}';end if;
  if length(coalesce(data->>'text','')) not between 1 and 1500 then raise exception 'invalid reply';end if;
  delay=greatest(5,least(43200,(data->>'delaySeconds')::int));away=greatest(0,least(43200,(data->>'awaySeconds')::int));
  update private.live_reply_jobs set status='ready',result=data-'lease'||jsonb_build_object('awaySeconds',away),payload='{}',due_at=now()+make_interval(secs=>delay),lease=null,lease_until=null,updated_at=now() where id=j.id;
  return jsonb_build_object('dueAt',now()+make_interval(secs=>delay));
 end if;
 if action='deliver' then
  -- Same character's send/enqueue/reset all lock its history first.
  for h in select hist.* from private.live_chat_history hist where exists(select 1 from private.live_reply_jobs jobs where jobs.character_id=hist.character_id and jobs.status='ready' and jobs.due_at<=now()) for update skip locked loop
   for j in select * from private.live_reply_jobs where character_id=h.character_id and status='ready' and due_at<=now() order by due_at for update skip locked loop
    if h.epoch<>j.epoch then update private.live_reply_jobs set status='cancelled',result=null where id=j.id;continue;end if;
    msg=jsonb_build_object('id','reply:'||j.id,'role','assistant','content',j.result->>'text','ts',floor(extract(epoch from clock_timestamp())*1000));
    perform public.live_sync_history(server_token,'append',j.character_id,j.epoch,jsonb_build_array(msg));
    update private.live_reply_jobs set status='complete',payload='{}',result=null,updated_at=now() where id=j.id;
    total=total+1;characters=characters||jsonb_build_array(j.character_id);
    insert into private.live_push_jobs(endpoint,message_id,payload) select p.endpoint,msg->>'id',jsonb_build_object('title',c.name,'body',msg->>'content','characterId',c.id,'messageId',msg->>'id') from private.live_push_subscriptions p join public.live_characters c on c.id=j.character_id where not exists(select 1 from private.live_presence presence where presence.device_id=p.device_id and presence.character_id=j.character_id and presence.seen_at>now()-interval '100 seconds') on conflict do nothing;
    away=coalesce((j.result->>'awaySeconds')::int,0);
    if away>0 then
     update private.live_reply_jobs set status='cancelled',payload='{}',result=null where character_id=j.character_id and kind='return' and status in ('queued','generating','ready');
     insert into private.live_activity(character_id,epoch,reason,until_at) values(j.character_id,j.epoch,coalesce(j.result->>'activity',msg->>'content'),clock_timestamp()+make_interval(secs=>away)) on conflict(character_id) do update set epoch=excluded.epoch,reason=excluded.reason,until_at=excluded.until_at,started_at=now();
     insert into private.live_reply_jobs(id,character_id,epoch,kind,due_at) values(gen_random_uuid(),j.character_id,j.epoch,'return',clock_timestamp()+make_interval(secs=>away));
    else delete from private.live_activity where character_id=j.character_id and epoch=j.epoch and (j.kind='return' or until_at<=now());end if;
    if jsonb_typeof(j.result->'photo')='object' then
     -- Reuse the image queue/quota checks; a quota failure leaves the delivered wait message and a visible failed image job.
     begin
      perform public.live_image_work(server_token,'create',j.id,j.character_id,j.result->'photo');photos=photos||jsonb_build_array(j.id);
     exception when others then
      insert into private.live_image_jobs(id,character_id,epoch,payload,status,error) values(j.id,j.character_id,j.epoch,j.result->'photo','failed','오늘 사진 생성 한도에 도달했어. 설정에서 한도를 확인해 줘.') on conflict do nothing;
     end;
    end if;
   end loop;
  end loop;
  delete from private.live_reply_jobs where status in ('complete','cancelled','failed') and updated_at<now()-interval '7 days';
  return jsonb_build_object('count',total,'photos',photos,'characters',characters);
 end if;
 raise exception 'invalid reply action';
end $$;
revoke all on function public.live_reply_work(text,text,uuid,uuid,jsonb) from public;
grant execute on function public.live_reply_work(text,text,uuid,uuid,jsonb) to anon;

create function private.live_clear_reply_work() returns trigger language plpgsql set search_path='' as $$
begin
 if new.epoch is distinct from old.epoch then
  delete from private.live_reply_jobs where character_id=new.character_id;
  delete from private.live_activity where character_id=new.character_id;
 end if;return new;
end $$;
revoke all on function private.live_clear_reply_work() from public,anon,authenticated;
create trigger live_clear_reply_work after update of epoch on private.live_chat_history for each row execute function private.live_clear_reply_work();

-- Existing proactive claims must respect activity and outstanding user replies.
do $patch$ declare definition text;begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 definition=replace(definition,'where st.enabled and st.next_attempt_at<=now()', 'where st.enabled and not exists(select 1 from private.live_activity act where act.character_id=st.character_id and act.until_at>now()) and not exists(select 1 from private.live_reply_jobs job where job.character_id=st.character_id and job.status in (''queued'',''generating'',''ready'')) and st.next_attempt_at<=now()');
 execute definition;
end $patch$;

create function private.live_reply_tick() returns bigint language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not exists(select 1 from private.live_reply_jobs where due_at<=now() and (status in ('queued','ready') or status='generating' and lease_until<now())) and not exists(select 1 from private.live_push_jobs where delivered_at is null and attempts<6 and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<now()) then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name=(select secret_name from private.live_companion_config where id);
 if token is null then return null;end if;
 return net.http_post(url:='https://haeon-relay.vercel.app/api/dokyeong/reply-worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=300000);
end $$;
revoke all on function private.live_reply_tick() from public,anon,authenticated;
select cron.schedule('live-realistic-replies','20 seconds','select private.live_reply_tick();');
notify pgrst,'reload schema';
