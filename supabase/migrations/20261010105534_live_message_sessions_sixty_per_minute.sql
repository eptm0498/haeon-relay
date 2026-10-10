-- Prepare short drafts in batches; a one-second DB tick delivers due slots.
-- A generation lease never blocks delivery, and other conversation writes
-- invalidate both queued drafts and in-flight generation before publication.
alter table private.live_message_sessions drop constraint live_message_sessions_check;
alter table private.live_message_sessions add constraint live_message_sessions_rate_check
 check(total between 1 and 10800 and total<=minutes*60);
alter table private.live_message_sessions add column drafts text[] not null default '{}',
 add column draft_context_count bigint, add column reserved_sent integer;

create function private.live_deliver_message_session(target uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare h private.live_chat_history%rowtype; s private.live_message_sessions%rowtype;
 c public.live_characters%rowtype; incoming jsonb='[]'; msg jsonb; merged jsonb;
 delivered integer=0; stamp bigint;
begin
 select * into h from private.live_chat_history where character_id=target for update skip locked;
 if not found then return 0;end if;
 select * into s from private.live_message_sessions where character_id=target for update skip locked;
 if not found or s.status<>'active' then return 0;end if;
 if s.epoch is distinct from h.epoch or s.ends_at<=clock_timestamp() then
  update private.live_message_sessions set status=case when epoch is distinct from h.epoch then 'stopped' else 'expired' end,
   drafts='{}',draft_context_count=null,lease=null,lease_until=null,reserved_count=null,reserved_sent=null where character_id=target;
  return 0;
 end if;
 if cardinality(s.drafts)>0 and s.draft_context_count is distinct from h.message_count-s.sent then
  update private.live_message_sessions set drafts='{}',draft_context_count=null,lease=null,lease_until=null,
   reserved_count=null,reserved_sent=null,next_attempt_at=clock_timestamp() where character_id=target;
  return 0;
 end if;
 select * into c from public.live_characters where id=target;
 stamp=greatest(floor(extract(epoch from clock_timestamp())*1000)::bigint,
  coalesce((select max(floor((m->>'ts')::numeric)::bigint)+1 from jsonb_array_elements(h.messages) m),0));
 while delivered<least(60,cardinality(s.drafts)) and s.sent+delivered<s.total
  and s.schedule[s.sent+delivered+1]<=clock_timestamp() loop
  msg=jsonb_build_object('id','session:'||s.id||':'||(s.sent+delivered+1),'role','assistant',
   'content',s.drafts[delivered+1],'ts',stamp+delivered,'proactive',true);
  incoming=incoming||jsonb_build_array(msg);delivered=delivered+1;
  insert into private.live_push_jobs(endpoint,message_id,payload) select endpoint,msg->>'id',
   jsonb_build_object('title',c.name,'body',msg->>'content','characterId',target,'messageId',msg->>'id')
   from private.live_push_subscriptions on conflict do nothing;
 end loop;
 if delivered=0 then return 0;end if;
 -- Same ordered 1,000-message window as sync_history. Its existing archive
 -- trigger preserves every event and advances message_count atomically.
 select coalesce(jsonb_agg(m order by (m->>'ts')::numeric,m->>'id'),'[]') into merged
  from (select m from jsonb_array_elements(h.messages||incoming) m
   order by (m->>'ts')::numeric desc,m->>'id' desc limit 1000) recent;
 update private.live_chat_history set messages=merged,updated_at=clock_timestamp() where character_id=target;
 update private.live_message_sessions set sent=sent+delivered,
  status=case when sent+delivered=total then 'completed' else 'active' end,
  drafts=coalesce(drafts[delivered+1:cardinality(drafts)],'{}'::text[]) where character_id=target;
 update private.live_companion_state set last_sent_at=clock_timestamp() where character_id=target;
 return delivered;
end $$;
revoke all on function private.live_deliver_message_session(uuid) from public,anon,authenticated;

create or replace function public.live_message_session_work(server_token text,action text,target_character uuid default null,data jsonb default '{}',claim_token uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.live_chat_history%rowtype; s private.live_message_sessions%rowtype;
 candidate uuid; request_id uuid; requested_minutes integer; requested_count integer;
 slots timestamptz[]; recent jsonb; c public.live_characters%rowtype; prepared text[];
 started timestamptz=clock_timestamp(); window_seconds double precision; lead_seconds double precision; batch_count integer;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid server capability' using errcode='28000';end if;
 if action='start' then
  if target_character is null or not exists(select 1 from public.live_characters where id=target_character) then raise exception 'invalid character' using errcode='22023';end if;
  if jsonb_typeof(data->'minutes') is distinct from 'number' or jsonb_typeof(data->'count') is distinct from 'number' or coalesce(data->>'sessionId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid session settings' using errcode='22023';end if;
  if (data->>'minutes')::numeric<>trunc((data->>'minutes')::numeric) or (data->>'count')::numeric<>trunc((data->>'count')::numeric) then raise exception 'invalid session settings' using errcode='22023';end if;
  requested_minutes=(data->>'minutes')::integer;requested_count=(data->>'count')::integer;request_id=(data->>'sessionId')::uuid;
  if requested_minutes not between 1 and 180 or requested_count not between 1 and 10800 or requested_count>requested_minutes*60 then raise exception 'invalid session settings' using errcode='22023';end if;
  insert into private.live_chat_history(character_id) values(target_character) on conflict do nothing;
  select * into h from private.live_chat_history where character_id=target_character for update;
  select * into s from private.live_message_sessions where character_id=target_character for update;
  if s.id=request_id then return private.live_message_session_status(target_character);end if;
  if s.status='active' and s.ends_at>started then raise exception 'session already active' using errcode='PT409';end if;
  lead_seconds=least(8,requested_minutes*60*0.1);
  window_seconds=requested_minutes*60-lead_seconds-least(10,requested_minutes*60*0.2);
  select array_agg(started+make_interval(secs=>lead_seconds+window_seconds*(i-0.5+(random()-0.5)*0.6)/requested_count) order by i)
   into slots from generate_series(1,requested_count) i;
  insert into private.live_message_sessions(character_id,id,epoch,status,minutes,total,sent,started_at,ends_at,schedule,next_attempt_at)
   values(target_character,request_id,h.epoch,'active',requested_minutes,requested_count,0,started,started+make_interval(mins=>requested_minutes),slots,started)
   on conflict on constraint live_message_sessions_pkey do update set id=excluded.id,epoch=excluded.epoch,status='active',minutes=excluded.minutes,total=excluded.total,sent=0,
    started_at=excluded.started_at,ends_at=excluded.ends_at,schedule=excluded.schedule,next_attempt_at=excluded.next_attempt_at,
    drafts='{}',draft_context_count=null,lease=null,lease_until=null,reserved_count=null,reserved_sent=null;
  insert into private.live_companion_state(character_id) values(target_character) on conflict do nothing;
  update private.live_companion_state set lease=null,lease_until=null,next_attempt_at=started+make_interval(mins=>requested_minutes) where character_id=target_character;
  return private.live_message_session_status(target_character);
 end if;
 if action='claim' then
  select st.character_id into candidate from private.live_message_sessions st
   where st.status='active' and (target_character is null or st.character_id=target_character) and st.ends_at>started
    and st.sent+cardinality(st.drafts)<st.total
    and cardinality(st.drafts)<=least(10,greatest(1,ceil(st.total/(st.minutes*6.0))::integer))
    and st.schedule[st.sent+cardinality(st.drafts)+1]<=started+interval '15 seconds'
    and st.next_attempt_at<=started and coalesce(st.lease_until,'-infinity')<=started
   order by st.schedule[st.sent+cardinality(st.drafts)+1] limit 1;
  if candidate is null then return null;end if;
  select * into h from private.live_chat_history where character_id=candidate for update skip locked;
  if not found then return null;end if;
  select * into s from private.live_message_sessions where character_id=candidate for update skip locked;
  if not found or s.status<>'active' or s.epoch is distinct from h.epoch or s.sent>=s.total or s.ends_at<=clock_timestamp() or s.lease_until>clock_timestamp() then return null;end if;
  if cardinality(s.drafts)>0 and s.draft_context_count is distinct from h.message_count-s.sent then
   s.drafts='{}';
   update private.live_message_sessions set drafts='{}',draft_context_count=null where character_id=candidate;
  end if;
  batch_count=least(30,greatest(1,ceil(s.total/(s.minutes*2.0))::integer),s.total-s.sent-cardinality(s.drafts));
  if batch_count<1 then return null;end if;
  update private.live_message_sessions set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',
   reserved_count=h.message_count,reserved_sent=sent where character_id=candidate returning * into s;
  select * into c from public.live_characters where id=candidate;
  select jsonb_agg(message order by seq) into recent from (select seq,message from private.live_message_events where character_id=candidate and epoch=h.epoch order by seq desc limit 40) x;
  return jsonb_build_object('character',jsonb_build_object('id',c.id,'prompt',c.prompt),'lease',s.lease,'sent',s.sent,'total',s.total,
   'batchCount',batch_count,'pending',s.drafts,'messages',coalesce(recent,'[]'),
   'memory',(select summary from private.live_memory where character_id=candidate and epoch=h.epoch));
 end if;
 if action in ('stop','commit','release') then
  select * into h from private.live_chat_history where character_id=target_character for update;
  select * into s from private.live_message_sessions where character_id=target_character for update;
  if not found then return null;end if;
  if action='stop' then
   if s.id is distinct from (data->>'sessionId')::uuid then return private.live_message_session_status(target_character);end if;
   update private.live_message_sessions set status=case when status='active' then 'stopped' else status end,
    drafts='{}',draft_context_count=null,lease=null,lease_until=null,reserved_count=null,reserved_sent=null where character_id=target_character;
   return private.live_message_session_status(target_character);
  end if;
  if claim_token is null or s.lease is distinct from claim_token then return null;end if;
  if action='release' then
   update private.live_message_sessions set lease=null,lease_until=null,reserved_count=null,reserved_sent=null,
    next_attempt_at=clock_timestamp()+interval '5 seconds' where character_id=target_character;return null;
  end if;
  if s.status<>'active' or h.epoch is distinct from s.epoch or s.sent>=s.total or s.ends_at<=clock_timestamp() or s.lease_until<=clock_timestamp() then
   update private.live_message_sessions set status=case when status='active' and ends_at<=clock_timestamp() then 'expired' when status='active' and epoch is distinct from h.epoch then 'stopped' else status end,
    drafts='{}',draft_context_count=null,lease=null,lease_until=null,reserved_count=null,reserved_sent=null where character_id=target_character;return null;
  end if;
  -- Delivery during generation is expected. Any OTHER new message means the
  -- user's reply or a normal reply changed context, so discard these drafts.
  if h.message_count-s.sent is distinct from s.reserved_count-s.reserved_sent then
   update private.live_message_sessions set drafts='{}',draft_context_count=null,lease=null,lease_until=null,
    reserved_count=null,reserved_sent=null,next_attempt_at=clock_timestamp() where character_id=target_character;return null;
  end if;
  if jsonb_typeof(data->'texts')='array' then
   if jsonb_array_length(data->'texts') not between 1 and 30 or exists(select 1 from jsonb_array_elements(data->'texts') t where jsonb_typeof(t)<>'string') then raise exception 'invalid short messages' using errcode='22023';end if;
   select array_agg(t order by i) into prepared from jsonb_array_elements_text(data->'texts') with ordinality x(t,i);
  else prepared=array[data->>'text'];end if;
  if exists(select 1 from unnest(prepared) t where length(btrim(coalesce(t,''))) not between 1 and 80 or t~E'[\n\r]')
   or cardinality(prepared)+cardinality(s.drafts)>s.total-s.sent then raise exception 'invalid short messages' using errcode='22023';end if;
  update private.live_message_sessions set drafts=drafts||prepared,draft_context_count=h.message_count-s.sent,
   lease=null,lease_until=null,reserved_count=null,reserved_sent=null,next_attempt_at=clock_timestamp() where character_id=target_character;
  perform private.live_deliver_message_session(target_character);
  return jsonb_build_object('prepared',cardinality(prepared));
 end if;
 raise exception 'invalid session action' using errcode='22023';
end $$;
revoke all on function public.live_message_session_work(text,text,uuid,jsonb,uuid) from public,authenticated;
grant execute on function public.live_message_session_work(text,text,uuid,jsonb,uuid) to anon;

create or replace function private.live_message_session_tick() returns bigint
language plpgsql security definer set search_path='' as $$
declare token text; candidate uuid; need_generation boolean;need_push boolean;
begin
 for candidate in select character_id from private.live_message_sessions where status='active' loop
  perform private.live_deliver_message_session(candidate);
 end loop;
 select exists(select 1 from private.live_message_sessions where status='active' and ends_at>now()
  and sent+cardinality(drafts)<total and cardinality(drafts)<=least(10,greatest(1,ceil(total/(minutes*6.0))::integer))
  and schedule[sent+cardinality(drafts)+1]<=now()+interval '15 seconds'
  and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<=now()) into need_generation;
 select exists(select 1 from private.live_push_jobs where delivered_at is null and next_attempt_at<=now()
  and coalesce(lease_until,'-infinity')<=now()) and floor(extract(epoch from now()))::bigint%5=0 into need_push;
 if not need_generation and not need_push then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name=(select secret_name from private.live_companion_config where id);
 if token is null then return null;end if;
 return net.http_post(url:='https://haeon-relay.vercel.app/api/dokyeong/session-worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=180000);
end $$;
revoke all on function private.live_message_session_tick() from public,anon,authenticated;
select cron.schedule('live-message-sessions','1 second','select private.live_message_session_tick();');
notify pgrst,'reload schema';
