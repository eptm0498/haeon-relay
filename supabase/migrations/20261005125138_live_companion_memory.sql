-- Raw text events are retained independently of the 1,000-message display window.
alter table private.live_chat_history add column message_count bigint not null default 0;
create table private.live_message_events (
 character_id uuid not null references public.live_characters(id) on delete cascade,
 epoch uuid not null, seq bigint not null, message_id text not null, message jsonb not null,
 primary key(character_id,epoch,seq),unique(character_id,epoch,message_id)
);
create table private.live_memory (
 character_id uuid primary key references public.live_characters(id) on delete cascade,
 epoch uuid not null, summary text not null default '', covered_count bigint not null default 0,
 claimed_count bigint, lease uuid, lease_until timestamptz, updated_at timestamptz not null default now()
);
create table private.live_companion_state (
 character_id uuid primary key references public.live_characters(id) on delete cascade,
 enabled boolean not null default true, seen_at timestamptz not null default now(),
 last_sent_at timestamptz, counter_day date,daily_count integer not null default 0,
 next_attempt_at timestamptz not null default now(),lease uuid,lease_until timestamptz,reserved_count bigint,reserved_epoch uuid
);
create table private.live_presence (
 device_id uuid primary key,character_id uuid references public.live_characters(id) on delete cascade,
 busy boolean not null default false,seen_at timestamptz not null default now()
);
create table private.live_push_subscriptions (
 endpoint text primary key,device_id uuid not null,keys jsonb not null,updated_at timestamptz not null default now()
);
create table private.live_push_jobs (
 id uuid primary key default gen_random_uuid(),endpoint text not null references private.live_push_subscriptions(endpoint) on delete cascade,
 message_id text not null,payload jsonb not null,attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),lease_until timestamptz,delivered_at timestamptz,
 unique(endpoint,message_id)
);
create table private.live_companion_config (id boolean primary key default true check(id),enabled boolean not null default false,secret_name text not null default 'character_live_worker');
insert into private.live_companion_config(id) values(true);

alter table private.live_message_events enable row level security;
alter table private.live_memory enable row level security;
alter table private.live_companion_state enable row level security;
alter table private.live_presence enable row level security;
alter table private.live_push_subscriptions enable row level security;
alter table private.live_push_jobs enable row level security;
alter table private.live_companion_config enable row level security;
revoke all on private.live_message_events,private.live_memory,private.live_companion_state,private.live_presence,private.live_push_subscriptions,private.live_push_jobs,private.live_companion_config from public,anon,authenticated;
create index live_push_pending on private.live_push_jobs(next_attempt_at) where delivered_at is null;
create index live_presence_character on private.live_presence(character_id,seen_at);

create function private.live_server_ok(token text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.live_history_key where key_hash=encode(extensions.digest(token,'sha256'),'hex'));
$$;
revoke all on function private.live_server_ok(text) from public,anon,authenticated;

create function private.live_archive_history() returns trigger language plpgsql set search_path='' as $$
declare item jsonb; next_seq bigint; old_epoch uuid;
begin
 if tg_op='UPDATE' then old_epoch=old.epoch; end if;
 if old_epoch is distinct from new.epoch then
  delete from private.live_message_events where character_id=new.character_id;
  delete from private.live_memory where character_id=new.character_id;
  new.message_count=0;
 else new.message_count=old.message_count;
 end if;
 next_seq=new.message_count;
 for item in select value from jsonb_array_elements(new.messages) order by (value->>'ts')::numeric,value->>'id' loop
  if not exists(select 1 from private.live_message_events where character_id=new.character_id and epoch=new.epoch and message_id=item->>'id') then
   next_seq=next_seq+1;
   insert into private.live_message_events(character_id,epoch,seq,message_id,message)
    values(new.character_id,new.epoch,next_seq,item->>'id',(item-'image') || jsonb_build_object('content',coalesce(nullif(item->>'content',''),case when item ? 'image' then '[사진] '||coalesce(item->>'imagePrompt','') else '' end)));
  end if;
 end loop;
 new.message_count=next_seq;
 return new;
end $$;
revoke all on function private.live_archive_history() from public,anon,authenticated;
create trigger live_archive_history before insert or update of messages,epoch on private.live_chat_history for each row execute function private.live_archive_history();
-- Backfill current conversations without changing their messages or epochs.
update private.live_chat_history set messages=messages;
insert into private.live_memory(character_id,epoch) select character_id,epoch from private.live_chat_history on conflict do nothing;
insert into private.live_companion_state(character_id) select id from public.live_characters on conflict do nothing;

create function public.live_memory_work(server_token text,action text,target_character uuid,expected_epoch uuid default null,lease_token uuid default null,new_summary text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.live_chat_history%rowtype; m private.live_memory%rowtype; batch jsonb;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid server capability' using errcode='28000'; end if;
 select * into h from private.live_chat_history where character_id=target_character;
 if not found then return null; end if;
 insert into private.live_memory(character_id,epoch) values(target_character,h.epoch) on conflict do nothing;
 select * into m from private.live_memory where character_id=target_character for update;
 if m.epoch<>h.epoch then return null; end if;
 if action='read' then return jsonb_build_object('epoch',m.epoch,'summary',m.summary,'covered_count',m.covered_count,'message_count',h.message_count,'pending',(select coalesce(jsonb_agg(message order by seq),'[]') from (select seq,message from private.live_message_events where character_id=target_character and epoch=h.epoch and seq>m.covered_count order by seq desc limit 100) x)); end if;
 if action='claim' then
  if h.message_count-m.covered_count<100 or m.lease_until>now() then return null; end if;
  update private.live_memory set lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',claimed_count=covered_count+100 where character_id=target_character returning * into m;
  select jsonb_agg(message order by seq) into batch from private.live_message_events where character_id=target_character and epoch=m.epoch and seq>m.covered_count and seq<=m.claimed_count;
  return to_jsonb(m)||jsonb_build_object('messages',batch);
 end if;
 if m.epoch is distinct from expected_epoch or m.lease is distinct from lease_token then raise exception 'stale memory work' using errcode='40001'; end if;
 if action='commit' then
  if coalesce(length(new_summary),0) not between 1 and 12000 then raise exception 'invalid summary' using errcode='22023'; end if;
  update private.live_memory set summary=new_summary,covered_count=claimed_count,lease=null,lease_until=null,claimed_count=null,updated_at=now() where character_id=target_character returning * into m;
 elsif action='release' then
  update private.live_memory set lease=null,lease_until=null,claimed_count=null where character_id=target_character;
 else raise exception 'invalid memory action' using errcode='22023'; end if;
 return jsonb_build_object('covered_count',m.covered_count);
end $$;
revoke all on function public.live_memory_work(text,text,uuid,uuid,uuid,text) from public;
grant execute on function public.live_memory_work(text,text,uuid,uuid,uuid,text) to anon;

create function public.live_companion_work(server_token text,action text,target_character uuid default null,device_id uuid default null,data jsonb default '{}',claim_token uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.live_chat_history%rowtype; s private.live_companion_state%rowtype; candidate uuid; recent jsonb; result jsonb; msg jsonb; c public.live_characters%rowtype;
 day_today date=(now() at time zone 'Asia/Seoul')::date; hour_now integer=extract(hour from now() at time zone 'Asia/Seoul'); last_user jsonb; last_ts timestamptz;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid server capability' using errcode='28000'; end if;
 insert into private.live_companion_state(character_id) select id from public.live_characters on conflict do nothing;
 if action in ('status','presence','preference','subscribe','unsubscribe') then
  if device_id is null then raise exception 'device required' using errcode='22023'; end if;
  if action='presence' then
   insert into private.live_presence(device_id,character_id,busy) values(device_id,case when data->>'visible'='true' then target_character else null end,data->>'busy'='true')
    on conflict on constraint live_presence_pkey do update set character_id=excluded.character_id,busy=excluded.busy,seen_at=now();
   if data->>'visible'='true' and target_character is not null then update private.live_companion_state set seen_at=now() where character_id=target_character; end if;
  elsif action='preference' then
   if jsonb_typeof(data->'enabled')<>'boolean' then raise exception 'invalid preference'; end if;
   update private.live_companion_state set enabled=(data->>'enabled')::boolean where character_id=target_character;
  elsif action='subscribe' then
   if length(data->>'endpoint')>2048 or jsonb_typeof(data->'keys')<>'object' then raise exception 'invalid subscription'; end if;
   insert into private.live_push_subscriptions(endpoint,device_id,keys) values(data->>'endpoint',device_id,data->'keys')
    on conflict on constraint live_push_subscriptions_pkey do update set device_id=excluded.device_id,keys=excluded.keys,updated_at=now();
  elsif action='unsubscribe' then delete from private.live_push_subscriptions where live_push_subscriptions.device_id=live_companion_work.device_id;
  end if;
  return jsonb_build_object('characters',(select jsonb_object_agg(character_id,jsonb_build_object('enabled',enabled,'seenAt',extract(epoch from seen_at)*1000)) from private.live_companion_state),'subscribed',exists(select 1 from private.live_push_subscriptions where live_push_subscriptions.device_id=live_companion_work.device_id));
 end if;
 if action='memory_due' then
  return (select coalesce(jsonb_agg(h.character_id),'[]') from private.live_chat_history h left join private.live_memory m on m.character_id=h.character_id where h.message_count-coalesce(m.covered_count,0)>=100);
 end if;
 if action='context' then
  select * into h from private.live_chat_history where character_id=target_character;
  select jsonb_agg(message order by seq) into recent from (select seq,message from private.live_message_events where character_id=target_character and epoch=h.epoch order by seq desc limit 24) x;
  return jsonb_build_object('epoch',h.epoch,'count',h.message_count,'messages',coalesce(recent,'[]'),'memory',(select summary from private.live_memory where character_id=target_character and epoch=h.epoch));
 end if;
 if action='push_jobs' then
  with jobs as (select id from private.live_push_jobs where delivered_at is null and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<now() order by next_attempt_at limit 20 for update skip locked), claimed as (
   update private.live_push_jobs j set lease_until=now()+interval '2 minutes' from jobs where j.id=jobs.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)||jsonb_build_object('keys',p.keys)),'[]') into result from claimed join private.live_push_subscriptions p using(endpoint);
  return result;
 end if;
 if action='push_ack' then
  if data->>'gone'='true' then delete from private.live_push_subscriptions where endpoint=data->>'endpoint';
  else update private.live_push_jobs set delivered_at=case when data->>'ok'='true' then now() else null end,attempts=attempts+1,lease_until=null,next_attempt_at=now()+interval '15 minutes' where id=(data->>'id')::uuid; end if;
  return '{}'::jsonb;
 end if;
 if action='claim' then
  perform pg_advisory_xact_lock(hashtext('character-live-proactive'));
  if hour_now between 1 and 7 or (select coalesce(sum(daily_count),0) from private.live_companion_state where counter_day=day_today)>=4 or exists(select 1 from private.live_companion_state where lease_until>now()) then return null; end if;
  for candidate in select st.character_id from private.live_companion_state st join public.live_characters ch on ch.id=st.character_id
   where st.enabled and st.next_attempt_at<=now() and coalesce(st.last_sent_at,'-infinity')<now()-interval '6 hours' and (st.counter_day is distinct from day_today or st.daily_count<2)
   order by coalesce(st.last_sent_at,'-infinity'),ch.sort_order loop
   select * into h from private.live_chat_history where character_id=candidate;
   if not found or h.message_count=0 then continue; end if;
   select message into last_user from private.live_message_events where character_id=candidate and epoch=h.epoch and message->>'role'='user' order by seq desc limit 1;
   if last_user is null then continue; end if;
   select to_timestamp(max((message->>'ts')::numeric)/1000) into last_ts from private.live_message_events where character_id=candidate and epoch=h.epoch;
   if last_ts>now()-interval '30 minutes' then continue; end if;
   if last_user->>'content' ~ '(잘게|자러 갈|자려고|수면제.{0,12}먹|졸피뎀.{0,12}먹)' and to_timestamp((last_user->>'ts')::numeric/1000)>now()-interval '12 hours' then continue; end if;
   if exists(select 1 from private.live_presence p where p.character_id=candidate and p.seen_at>now()-interval '100 seconds') then continue; end if;
   select * into c from public.live_characters where id=candidate;
   update private.live_companion_state set lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',reserved_count=h.message_count,reserved_epoch=h.epoch where character_id=candidate returning * into s;
   select jsonb_agg(message order by seq) into recent from (select seq,message from private.live_message_events where character_id=candidate and epoch=h.epoch order by seq desc limit 24) x;
   return jsonb_build_object('character',to_jsonb(c)-'avatar_url','lease',s.lease,'epoch',h.epoch,'count',h.message_count,'messages',recent,'memory',(select summary from private.live_memory where character_id=candidate and epoch=h.epoch));
  end loop;
  return null;
 end if;
 if action in ('commit','release') then
  select * into h from private.live_chat_history where character_id=target_character for update;
  select * into s from private.live_companion_state where character_id=target_character for update;
  if s.lease is distinct from claim_token or claim_token is null then return null; end if;
  if action='release' then
   update private.live_companion_state set lease=null,lease_until=null,next_attempt_at=now()+case when data->>'retry'='true' then interval '5 minutes' else interval '1 hour' end where character_id=target_character;
   return '{}'::jsonb;
  end if;
  if not s.enabled or h.epoch<>s.reserved_epoch or h.message_count<>s.reserved_count or exists(select 1 from private.live_presence p where p.character_id=target_character and p.seen_at>now()-interval '100 seconds') then
   update private.live_companion_state set lease=null,lease_until=null where character_id=target_character;
   return null;
  end if;
  if length(coalesce(data->>'text','')) not between 1 and 1500 then raise exception 'invalid proactive text'; end if;
  msg=jsonb_build_object('id',gen_random_uuid(),'role','assistant','content',data->>'text','ts',floor(extract(epoch from clock_timestamp())*1000),'proactive',true);
  perform public.live_sync_history(server_token,'append',target_character,h.epoch,jsonb_build_array(msg));
  update private.live_companion_state set last_sent_at=now(),counter_day=day_today,daily_count=case when counter_day=day_today then daily_count+1 else 1 end,lease=null,lease_until=null where character_id=target_character;
  select * into c from public.live_characters where id=target_character;
  insert into private.live_push_jobs(endpoint,message_id,payload) select endpoint,msg->>'id',jsonb_build_object('title',c.name,'body',msg->>'content','characterId',target_character,'messageId',msg->>'id') from private.live_push_subscriptions on conflict do nothing;
  return msg;
 end if;
 raise exception 'invalid companion action' using errcode='22023';
end $$;
revoke all on function public.live_companion_work(text,text,uuid,uuid,jsonb,uuid) from public;
grant execute on function public.live_companion_work(text,text,uuid,uuid,jsonb,uuid) to anon;

create function private.live_companion_tick() returns bigint language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not exists(select 1 from private.live_companion_config where id and enabled) then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name=(select secret_name from private.live_companion_config where id);
 if token is null then return null; end if;
 return net.http_post(url:='https://haeon-relay.vercel.app/api/dokyeong/worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=240000);
end $$;
revoke all on function private.live_companion_tick() from public,anon,authenticated;
select cron.schedule('character-live-companion','*/5 * * * *','select private.live_companion_tick();');
notify pgrst,'reload schema';
