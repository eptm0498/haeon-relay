create table private.live_media (
 character_id uuid not null references public.live_characters(id) on delete cascade,
 message_id text not null,image jsonb not null,created_at timestamptz not null default now(),primary key(character_id,message_id)
);
create table private.live_preferences (
 id boolean primary key default true check(id), quiet_start integer not null default 1 check(quiet_start between 0 and 23),quiet_end integer not null default 8 check(quiet_end between 0 and 23),
 daily_cap integer not null default 4 check(daily_cap between 1 and 20),interval_hours integer not null default 6 check(interval_hours between 1 and 24),image_daily_limit integer not null default 10 check(image_daily_limit between 1 and 100),
 routine text not null default '', situation text not null default '',version integer not null default 1
);
insert into private.live_preferences(id) values(true);
create table private.live_image_jobs (
 id uuid primary key,character_id uuid not null references public.live_characters(id) on delete cascade,epoch uuid not null,payload jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','complete','failed')),attempts integer not null default 0,
 lease uuid,lease_until timestamptz,next_attempt_at timestamptz not null default now(),error text not null default '',message_id text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table private.live_media enable row level security;
alter table private.live_preferences enable row level security;
alter table private.live_image_jobs enable row level security;
revoke all on private.live_media,private.live_preferences,private.live_image_jobs from public,anon,authenticated;
create index live_image_jobs_due on private.live_image_jobs(next_attempt_at) where status in ('queued','running');
insert into private.live_media(character_id,message_id,image) select character_id,item->>'id',item->'image' from private.live_chat_history cross join lateral jsonb_array_elements(messages) item where item->'image'->>'dataUrl' like 'data:image/%' on conflict do nothing;
update private.live_chat_history h set messages=(select jsonb_agg(case when item->'image'->>'dataUrl' like 'data:image/%' then jsonb_set(item,'{image}',jsonb_build_object('mimeType',item->'image'->>'mimeType','dataUrl','/api/dokyeong/media/'||h.character_id||'/'||(item->>'id'))) else item end order by ord) from jsonb_array_elements(h.messages) with ordinality x(item,ord)) where jsonb_array_length(messages)>0;

alter function public.live_sync_history(text,text,uuid,uuid,jsonb) set schema private;
alter function private.live_sync_history(text,text,uuid,uuid,jsonb) rename to live_sync_history_v1;
revoke all on function private.live_sync_history_v1(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
create function public.live_sync_history(server_token text,action text default 'read',target_character uuid default null,expected_epoch uuid default null,incoming jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;item jsonb;clean jsonb:='[]';
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid capability' using errcode='28000';end if;
 if action in ('append','import') then
  -- Lock/check the conversation before storing any media.
  perform 1 from private.live_chat_history where character_id=target_character and epoch=expected_epoch for update;
  if not found then raise exception 'conversation changed' using errcode='40001';end if;
  for item in select value from jsonb_array_elements(incoming) loop
   if item->'image'->>'dataUrl' like 'data:image/%' then
    if length(item->'image'->>'dataUrl')>1850000 then raise exception 'image too large';end if;
    insert into private.live_media(character_id,message_id,image) values(target_character,item->>'id',item->'image') on conflict do nothing;
    item=jsonb_set(item,'{image}',jsonb_build_object('mimeType',item->'image'->>'mimeType','dataUrl','/api/dokyeong/media/'||target_character||'/'||(item->>'id')));
   end if;
   clean=clean||jsonb_build_array(item);
  end loop;
 else clean=incoming;end if;
 result=private.live_sync_history_v1(server_token,action,target_character,expected_epoch,clean);
 if action='reset' then delete from private.live_media where character_id=target_character;delete from private.live_image_jobs where character_id=target_character;delete from private.live_push_jobs where payload->>'characterId'=target_character::text;end if;
 if action='read' then
  select coalesce(jsonb_agg(jsonb_set(row,'{messages}',coalesce((select jsonb_agg(m order by (m->>'ts')::numeric,m->>'id') from (select m from jsonb_array_elements(row->'messages') m order by (m->>'ts')::numeric desc,m->>'id' desc limit 100) x),'[]'))),'[]') into result from jsonb_array_elements(result) row;
 else
  result=jsonb_set(result,'{messages}',coalesce((select jsonb_agg(m order by (m->>'ts')::numeric,m->>'id') from (select m from jsonb_array_elements(result->'messages') m order by (m->>'ts')::numeric desc,m->>'id' desc limit 100) x),'[]'));
 end if;
 return result;
end $$;
revoke all on function public.live_sync_history(text,text,uuid,uuid,jsonb) from public;
grant execute on function public.live_sync_history(text,text,uuid,uuid,jsonb) to anon;

create function public.live_data_work(server_token text,action text,target_character uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.live_chat_history%rowtype;memo text;result jsonb;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid capability' using errcode='28000';end if;
 if action='versions' then
  insert into private.live_chat_history(character_id) select id from public.live_characters on conflict do nothing;
  return (select jsonb_agg(jsonb_build_object('id',character_id,'epoch',epoch,'updated',updated_at,'count',message_count)) from private.live_chat_history);
 elsif action='media' then return (select image from private.live_media where character_id=target_character and message_id=data->>'messageId');
 elsif action='settings' then return (select to_jsonb(p) from private.live_preferences p where id);
 elsif action='settings_save' then
  if jsonb_typeof(data)<>'object' or length(coalesce(data->>'routine',''))>2000 or length(coalesce(data->>'situation',''))>1000 then raise exception 'invalid settings';end if;
  update private.live_preferences set quiet_start=(data->>'quiet_start')::int,quiet_end=(data->>'quiet_end')::int,daily_cap=(data->>'daily_cap')::int,interval_hours=(data->>'interval_hours')::int,image_daily_limit=(data->>'image_daily_limit')::int,routine=data->>'routine',situation=data->>'situation',version=version+1 where id and version=(data->>'version')::int returning to_jsonb(live_preferences) into result;
  if result is null then raise exception 'settings changed' using errcode='40001';end if;return result;
 elsif action='memory_save' then
  select * into h from private.live_chat_history where character_id=target_character for update;
  if h.epoch::text<>data->>'epoch' then raise exception 'conversation changed' using errcode='40001';end if;
  if length(coalesce(data->>'summary',''))>12000 then raise exception 'memory too large';end if;
  insert into private.live_memory(character_id,epoch,summary,covered_count) values(target_character,h.epoch,data->>'summary',h.message_count) on conflict(character_id) do update set summary=excluded.summary,covered_count=excluded.covered_count,lease=null,lease_until=null,claimed_count=null,updated_at=now();
  return jsonb_build_object('saved',true);
 elsif action='reset_keep_memory' then
  select summary into memo from private.live_memory where character_id=target_character;
  result=public.live_sync_history(server_token,'reset',target_character,(data->>'epoch')::uuid);
  if coalesce(memo,'')<>'' then insert into private.live_memory(character_id,epoch,summary) values(target_character,(result->>'epoch')::uuid,memo);end if;return result;
 elsif action in ('archive','search','export') then
  select * into h from private.live_chat_history where character_id=target_character;
  select coalesce(jsonb_agg(item order by seq),'[]') into result from (
   select ev.seq,ev.message || case when med.message_id is not null then jsonb_build_object('image',jsonb_build_object('mimeType',med.image->>'mimeType','dataUrl','/api/dokyeong/media/'||target_character||'/'||ev.message_id)) else '{}' end as item
   from private.live_message_events ev left join private.live_media med on med.character_id=ev.character_id and med.message_id=ev.message_id
   where ev.character_id=target_character and ev.epoch=h.epoch and (data->>'before' is null or ev.seq<(data->>'before')::bigint)
    and (action<>'search' or ev.message->>'content' ilike '%'||left(coalesce(data->>'query',''),200)||'%')
   order by ev.seq desc limit 100
  ) x;
  return jsonb_build_object('messages',result,'before',(select min(seq) from private.live_message_events where character_id=target_character and epoch=h.epoch and message_id in (select v->>'id' from jsonb_array_elements(result) v)),'epoch',h.epoch);
 end if;
 raise exception 'invalid data action';
end $$;
revoke all on function public.live_data_work(text,text,uuid,jsonb) from public;
grant execute on function public.live_data_work(text,text,uuid,jsonb) to anon;

create function public.live_image_work(server_token text,action text,target_job uuid default null,target_character uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.live_image_jobs%rowtype;h private.live_chat_history%rowtype;msg jsonb;cap integer;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid capability' using errcode='28000';end if;
 if action='create' then
  perform pg_advisory_xact_lock(hashtext('live-image-quota'));
  select * into j from private.live_image_jobs where id=target_job;
  if found then if j.character_id<>target_character then raise exception 'job changed';end if;return to_jsonb(j)-'payload'-'lease';end if;
  select * into h from private.live_chat_history where character_id=target_character;
  if not found then raise exception 'history missing';end if;
  select image_daily_limit into cap from private.live_preferences where id;
  if (select count(*) from private.live_image_jobs where created_at >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')>=cap then raise exception 'IMAGE_DAILY_LIMIT' using errcode='P0001';end if;
  insert into private.live_image_jobs(id,character_id,epoch,payload) values(target_job,target_character,h.epoch,data) returning * into j;
 elsif action='read' then select * into j from private.live_image_jobs where id=target_job;
 elsif action='retry' then
  update private.live_image_jobs set status='queued',lease=null,lease_until=null,next_attempt_at=now(),error='',updated_at=now() where id=target_job and status='failed' and attempts<3 returning * into j;
 elsif action='claim' then
  select * into j from private.live_image_jobs where (target_job is null or id=target_job) and status in ('queued','running') and attempts<3 and next_attempt_at<=now() and coalesce(lease_until,'-infinity')<now() order by created_at limit 1 for update skip locked;
  if not found then return null;end if;
  update private.live_image_jobs set status='running',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=j.id returning * into j;return to_jsonb(j);
 elsif action in ('complete','fail') then
  select * into j from private.live_image_jobs where id=target_job for update;
  if j.lease::text is distinct from data->>'lease' or j.status<>'running' then return null;end if;
  select * into h from private.live_chat_history where character_id=j.character_id for update;
  if h.epoch<>j.epoch then return null;end if;
  if action='complete' then
   msg=jsonb_build_object('id',j.id,'role','assistant','content','','ts',floor(extract(epoch from clock_timestamp())*1000),'image',data->'image','imagePrompt',j.payload->>'scene');
   perform public.live_sync_history(server_token,'append',j.character_id,j.epoch,jsonb_build_array(msg));
   update private.live_image_jobs set status='complete',message_id=j.id::text,lease=null,lease_until=null,error='',updated_at=now() where id=j.id returning * into j;
   insert into private.live_push_jobs(endpoint,message_id,payload) select endpoint,j.id::text,jsonb_build_object('title',ch.name,'body','사진을 보냈어.','characterId',j.character_id,'messageId',j.id) from private.live_push_subscriptions sub cross join public.live_characters ch where ch.id=j.character_id and not exists(select 1 from private.live_presence pr where pr.device_id=sub.device_id and pr.character_id=j.character_id and pr.seen_at>now()-interval '100 seconds') on conflict do nothing;
  else update private.live_image_jobs set status='failed',error=left(data->>'error',300),lease=null,lease_until=null,updated_at=now() where id=j.id returning * into j;end if;
 elsif action='list' then return (select coalesce(jsonb_agg(to_jsonb(x)-'payload'-'lease'),'[]') from (select * from private.live_image_jobs where character_id=target_character and (status<>'complete' or updated_at>now()-interval '1 hour') order by created_at desc limit 10) x);
 else raise exception 'invalid image action';end if;
 if j.id is null then return null;end if;return to_jsonb(j)-'payload'-'lease';
end $$;
revoke all on function public.live_image_work(text,text,uuid,uuid,jsonb) from public;
grant execute on function public.live_image_work(text,text,uuid,uuid,jsonb) to anon;

create function private.live_delete_notifications() returns trigger language plpgsql security definer set search_path='' as $$begin delete from private.live_push_jobs where payload->>'characterId'=old.id::text;return old;end $$;
revoke all on function private.live_delete_notifications() from public,anon,authenticated;
create trigger live_delete_notifications before delete on public.live_characters for each row execute function private.live_delete_notifications();
-- Replace fixed quiet hours and pacing with user preferences; remove broad sleep regex.
do $patch$
declare definition text;
begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 definition=replace(definition,'hour_now between 1 and 7','(select case when quiet_start=quiet_end then false when quiet_start<quiet_end then hour_now>=quiet_start and hour_now<quiet_end else hour_now>=quiet_start or hour_now<quiet_end end from private.live_preferences where id)');
 definition=replace(definition,'>=4','>=(select daily_cap from private.live_preferences where id)');
 definition=replace(definition,'now()-interval ''6 hours''','now()-make_interval(hours=>(select interval_hours from private.live_preferences where id))');
 definition=replace(definition,'   if last_user->>''content'' ~ ''(잘게|자러 갈|자려고|수면제.{0,12}먹|졸피뎀.{0,12}먹)'' and to_timestamp((last_user->>''ts'')::numeric/1000)>now()-interval ''12 hours'' then continue; end if;','');
 definition=replace(definition,'''lease_until=now()+interval ''2 minutes''','''lease_until=now()+interval ''5 minutes''');
 execute definition;
end $patch$;
-- Cleanup expired jobs and skip stale/deleted notification payloads.
delete from private.live_push_jobs where not exists(select 1 from public.live_characters where id::text=payload->>'characterId');
create function private.live_image_tick() returns bigint language plpgsql security definer set search_path='' as $$declare token text;begin
 if not exists(select 1 from private.live_companion_config where id and enabled) then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='character_live_worker' limit 1;
 if token is null then return null;end if;
 delete from private.live_push_jobs where delivered_at<now()-interval '7 days' or attempts>=6 or next_attempt_at<now()-interval '2 days';
 return net.http_post(url:='https://haeon-relay.vercel.app/api/dokyeong/image-worker',headers:=jsonb_build_object('Authorization','Bearer '||token,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function private.live_image_tick() from public,anon,authenticated;
select cron.schedule('live-image-recovery','*/5 * * * *','select private.live_image_tick()');
notify pgrst,'reload schema';
create function public.live_server_character(server_token text,character_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.live_server_ok(server_token) then raise exception 'invalid capability' using errcode='28000';end if;
 return (select to_jsonb(c) from public.live_read_character(character_id) c);
end $$;
revoke all on function public.live_server_character(text,uuid) from public;
grant execute on function public.live_server_character(text,uuid) to anon;
