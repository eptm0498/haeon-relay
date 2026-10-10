-- A user-authorized, bounded session is independent of ordinary proactive caps.
create table private.live_message_sessions (
 character_id uuid primary key references public.live_characters(id) on delete cascade,
 id uuid not null unique, epoch uuid not null,
 status text not null check(status in ('active','completed','stopped','expired')),
 minutes integer not null check(minutes between 1 and 180),
 total integer not null check(total between 1 and 120 and total<=minutes*2),
 sent integer not null default 0 check(sent between 0 and total),
 started_at timestamptz not null, ends_at timestamptz not null,
 schedule timestamptz[] not null, next_attempt_at timestamptz not null default now(),
 lease uuid, lease_until timestamptz, reserved_count bigint,
 check(ends_at>started_at), check(cardinality(schedule)=total)
);
alter table private.live_message_sessions enable row level security;
revoke all on private.live_message_sessions from public,anon,authenticated;
create index live_message_sessions_due on private.live_message_sessions(next_attempt_at) where status='active';

create function private.live_message_session_status(lookup_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'status',case when status='active' and ends_at<=now() then 'expired' else status end,
  'minutes',minutes,'total',total,'sent',sent,'startedAt',extract(epoch from started_at)*1000,'endsAt',extract(epoch from ends_at)*1000)
 from private.live_message_sessions where character_id=lookup_id;
$$;
revoke all on function private.live_message_session_status(uuid) from public,anon,authenticated;

create function public.live_message_session_work(server_token text,action text,target_character uuid default null,data jsonb default '{}',claim_token uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.live_chat_history%rowtype; s private.live_message_sessions%rowtype;
 candidate uuid; request_id uuid; requested_minutes integer; requested_count integer;
 slots timestamptz[]; recent jsonb; c public.live_characters%rowtype; msg jsonb;
 started timestamptz=clock_timestamp(); window_seconds double precision;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid server capability' using errcode='28000'; end if;
 if action='start' then
  if target_character is null or not exists(select 1 from public.live_characters where id=target_character) then raise exception 'invalid character' using errcode='22023';end if;
  if jsonb_typeof(data->'minutes') is distinct from 'number' or jsonb_typeof(data->'count') is distinct from 'number' or coalesce(data->>'sessionId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid session settings' using errcode='22023';end if;
  if (data->>'minutes')::numeric<>trunc((data->>'minutes')::numeric) or (data->>'count')::numeric<>trunc((data->>'count')::numeric) then raise exception 'invalid session settings' using errcode='22023';end if;
  requested_minutes=(data->>'minutes')::integer; requested_count=(data->>'count')::integer;request_id=(data->>'sessionId')::uuid;
  if requested_minutes not between 1 and 180 or requested_count not between 1 and 120 or requested_count>requested_minutes*2 then raise exception 'invalid session settings' using errcode='22023';end if;
  insert into private.live_chat_history(character_id) values(target_character) on conflict do nothing;
  select * into h from private.live_chat_history where character_id=target_character for update;
  select * into s from private.live_message_sessions where character_id=target_character for update;
  if s.id=request_id then return private.live_message_session_status(target_character);end if;
  if s.status='active' and s.ends_at>started then raise exception 'session already active' using errcode='PT409';end if;
  -- Stratified jitter spreads exactly N slots across the window. Reserve up to a
  -- minute for final generation/retries rather than starting work at the deadline.
  window_seconds=requested_minutes*60-least(60,requested_minutes*60*0.4);
  select array_agg(started+make_interval(secs=>window_seconds*(i-0.5+(random()-0.5)*0.6)/requested_count) order by i)
   into slots from generate_series(1,requested_count) i;
  insert into private.live_message_sessions(character_id,id,epoch,status,minutes,total,sent,started_at,ends_at,schedule,next_attempt_at)
   values(target_character,request_id,h.epoch,'active',requested_minutes,requested_count,0,started,started+make_interval(mins=>requested_minutes),slots,started)
   on conflict on constraint live_message_sessions_pkey do update set id=excluded.id,epoch=excluded.epoch,status='active',minutes=excluded.minutes,total=excluded.total,sent=0,
    started_at=excluded.started_at,ends_at=excluded.ends_at,schedule=excluded.schedule,next_attempt_at=excluded.next_attempt_at,lease=null,lease_until=null,reserved_count=null;
  -- Invalidate an ordinary proactive generation that was already in flight.
  insert into private.live_companion_state(character_id) values(target_character) on conflict do nothing;
  update private.live_companion_state set lease=null,lease_until=null,next_attempt_at=started+make_interval(mins=>requested_minutes) where character_id=target_character;
  return private.live_message_session_status(target_character);
 end if;
 if action='claim' then
  select st.character_id into candidate from private.live_message_sessions st
   where st.status='active' and (target_character is null or st.character_id=target_character) and st.sent<st.total and st.ends_at>started and st.schedule[st.sent+1]<=started
    and st.next_attempt_at<=started and coalesce(st.lease_until,'-infinity')<=started
   order by st.schedule[st.sent+1] limit 1;
  if candidate is null then return null;end if;
  -- Every writer locks history before session, including reset and stop.
  select * into h from private.live_chat_history where character_id=candidate for update skip locked;
  if not found then return null;end if;
  select * into s from private.live_message_sessions where character_id=candidate for update;
  if s.status<>'active' or s.epoch<>h.epoch or s.sent>=s.total or s.ends_at<=clock_timestamp() or s.lease_until>clock_timestamp() then return null;end if;
  update private.live_message_sessions set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',reserved_count=h.message_count where character_id=candidate returning * into s;
  select * into c from public.live_characters where id=candidate;
  select jsonb_agg(message order by seq) into recent from (select seq,message from private.live_message_events where character_id=candidate and epoch=h.epoch order by seq desc limit 40) x;
  return jsonb_build_object('character',jsonb_build_object('id',c.id,'prompt',c.prompt),'lease',s.lease,'sent',s.sent,'total',s.total,'messages',coalesce(recent,'[]'),
   'memory',(select summary from private.live_memory where character_id=candidate and epoch=h.epoch));
 end if;
 if action in ('stop','commit','release') then
  select * into h from private.live_chat_history where character_id=target_character for update;
  select * into s from private.live_message_sessions where character_id=target_character for update;
  if not found then return null;end if;
  if action='stop' then
   if s.id is distinct from (data->>'sessionId')::uuid then return private.live_message_session_status(target_character);end if;
   update private.live_message_sessions set status=case when status='active' then 'stopped' else status end,lease=null,lease_until=null,reserved_count=null where character_id=target_character;
   return private.live_message_session_status(target_character);
  end if;
  if claim_token is null or s.lease is distinct from claim_token then return null;end if;
  if action='release' then
   update private.live_message_sessions set lease=null,lease_until=null,reserved_count=null,next_attempt_at=clock_timestamp()+interval '5 seconds' where character_id=target_character;
   return null;
  end if;
  if s.status<>'active' or h.epoch is distinct from s.epoch or s.sent>=s.total or s.ends_at<=clock_timestamp() or s.lease_until<=clock_timestamp() then
   update private.live_message_sessions set status=case when status='active' and ends_at<=clock_timestamp() then 'expired' when status='active' and epoch is distinct from h.epoch then 'stopped' else status end,lease=null,lease_until=null,reserved_count=null where character_id=target_character;
   return null;
  end if;
  -- A reply arriving during generation invalidates that draft. Claim again with
  -- fresh context without consuming a slot or changing the end time.
  if h.message_count<>s.reserved_count then
   update private.live_message_sessions set lease=null,lease_until=null,reserved_count=null,next_attempt_at=clock_timestamp() where character_id=target_character;return null;
  end if;
  if length(btrim(coalesce(data->>'text',''))) not between 1 and 80 or data->>'text' ~ E'[\n\r]' then raise exception 'invalid short message' using errcode='22023';end if;
  msg=jsonb_build_object('id','session:'||s.id||':'||(s.sent+1),'role','assistant','content',btrim(data->>'text'),'ts',floor(extract(epoch from clock_timestamp())*1000),'proactive',true);
  perform public.live_sync_history(server_token,'append',target_character,h.epoch,jsonb_build_array(msg));
  update private.live_message_sessions set sent=sent+1,status=case when sent+1=total then 'completed' else 'active' end,lease=null,lease_until=null,reserved_count=null,next_attempt_at=clock_timestamp() where character_id=target_character;
  update private.live_companion_state set last_sent_at=clock_timestamp() where character_id=target_character;
  select * into c from public.live_characters where id=target_character;
  insert into private.live_push_jobs(endpoint,message_id,payload) select endpoint,msg->>'id',jsonb_build_object('title',c.name,'body',msg->>'content','characterId',target_character,'messageId',msg->>'id') from private.live_push_subscriptions on conflict do nothing;
  return msg;
 end if;
 raise exception 'invalid session action' using errcode='22023';
end $$;
revoke all on function public.live_message_session_work(text,text,uuid,jsonb,uuid) from public,authenticated;
grant execute on function public.live_message_session_work(text,text,uuid,jsonb,uuid) to anon;

create function private.live_cancel_message_session() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.epoch is distinct from new.epoch then
  update private.live_message_sessions set status='stopped',lease=null,lease_until=null,reserved_count=null where character_id=new.character_id and status='active';
 end if;return new;
end $$;
revoke all on function private.live_cancel_message_session() from public,anon,authenticated;
create trigger live_cancel_message_session after update of epoch on private.live_chat_history for each row execute function private.live_cancel_message_session();

do $patch$ declare definition text; old_text text;new_text text;begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 old_text='jsonb_build_object(''enabled'',enabled,''seenAt'',extract(epoch from seen_at)*1000)';
 new_text='jsonb_build_object(''enabled'',enabled,''seenAt'',extract(epoch from seen_at)*1000,''session'',private.live_message_session_status(character_id))';
 if strpos(definition,old_text)=0 then raise exception 'companion status patch mismatch';end if;
 definition=replace(definition,old_text,new_text);
 old_text='where st.enabled and ';
 new_text='where st.enabled and not exists(select 1 from private.live_message_sessions session where session.character_id=st.character_id and session.status=''active'' and session.ends_at>now()) and ';
 if strpos(definition,old_text)=0 then raise exception 'companion claim patch mismatch';end if;
 definition=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

create function private.live_message_session_tick() returns bigint
language plpgsql security definer set search_path='' as $$
declare token text;
begin
 update private.live_message_sessions set status='expired',lease=null,lease_until=null,reserved_count=null where status='active' and ends_at<=now();
 if not exists(select 1 from private.live_message_sessions where status='active' and sent<total and schedule[sent+1]<=now() and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<=now()) then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name=(select secret_name from private.live_companion_config where id);
 if token is null then return null;end if;
 return net.http_post(url:='https://haeon-relay.vercel.app/api/dokyeong/session-worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=180000);
end $$;
revoke all on function private.live_message_session_tick() from public,anon,authenticated;
select cron.schedule('live-message-sessions','10 seconds','select private.live_message_session_tick();');
notify pgrst,'reload schema';
