create table private.live_voip_devices (
  token text primary key check (token ~ '^[a-f0-9]{32,256}$'),
  environment text not null check (environment in ('development','production')),
  valid_until timestamptz not null
);
create table private.live_voip_jobs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references private.live_jiwoo_calls(id) on delete cascade,
  token text not null references private.live_voip_devices(token) on delete cascade,
  lease_until timestamptz,
  complete boolean not null default false,
  unique (call_id, token)
);
alter table private.live_voip_devices enable row level security;
alter table private.live_voip_jobs enable row level security;
revoke all on private.live_voip_devices, private.live_voip_jobs from public, anon, authenticated;
create index live_voip_jobs_pending on private.live_voip_jobs(call_id) where not complete;

create function private.live_queue_voip_calls() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into private.live_voip_jobs(call_id, token)
    select new.id, d.token from private.live_voip_devices d where d.valid_until > clock_timestamp()
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.live_queue_voip_calls() from public, anon, authenticated;
create trigger live_queue_voip_calls after insert on private.live_jiwoo_calls
  for each row execute function private.live_queue_voip_calls();

create function public.live_voip_work(server_token text, action text, device_token text default null,
  push_environment text default null, valid_until timestamptz default null, job_id uuid default null,
  complete boolean default false, gone boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.live_server_ok(server_token) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if action = 'register' then
    if valid_until is null or valid_until <= now() or valid_until > now() + interval '31 days' then
      raise exception 'invalid registration lifetime' using errcode = '22023';
    end if;
    insert into private.live_voip_devices(token, environment, valid_until)
      values(device_token, push_environment, live_voip_work.valid_until)
      on conflict (token) do update set environment = excluded.environment, valid_until = excluded.valid_until;
  elsif action = 'unregister' then
    delete from private.live_voip_devices d where d.token = device_token and d.environment = push_environment;
  elsif action = 'claim' then
    with pending as (
      select j.id
      from private.live_voip_jobs j join private.live_jiwoo_calls c on c.id = j.call_id
      join private.live_voip_devices d on d.token = j.token
      where not j.complete and coalesce(j.lease_until,'-infinity') < now()
        and c.status = 'ringing' and c.expires_at > now() and d.valid_until > now()
      order by c.started_at
      limit 10 for update of j skip locked
    ), leased as (
      update private.live_voip_jobs j set lease_until = now() + interval '20 seconds'
      from pending where j.id = pending.id returning j.*
    )
    select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'callId',c.id,
      'expiresAt',extract(epoch from c.expires_at)*1000,'token',j.token,'environment',d.environment)), '[]'::jsonb)
    into result from leased j join private.live_jiwoo_calls c on c.id = j.call_id
      join private.live_voip_devices d on d.token = j.token;
    return result;
  elsif action = 'ack' then
    if gone then
      delete from private.live_voip_devices d using private.live_voip_jobs j
      where j.id = job_id and j.token = d.token;
    else
      update private.live_voip_jobs j set complete = live_voip_work.complete, lease_until = null where j.id = job_id;
    end if;
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.live_voip_work(text,text,text,text,timestamptz,uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function public.live_voip_work(text,text,text,text,timestamptz,uuid,boolean,boolean) to anon;
create or replace function public.live_jiwoo_call_work(server_token text, action text, call_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  current_at timestamptz := clock_timestamp();
  local_at timestamp := current_at at time zone 'Asia/Seoul';
  local_hour integer := extract(hour from local_at);
  settings jsonb;
  period text;
  quiet_from integer;
  quiet_until integer;
  last_message timestamptz;
  call private.live_jiwoo_calls%rowtype;
begin
  if not private.live_server_ok(server_token) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;

  if action = 'tick' then
    perform pg_advisory_xact_lock(287319, 1);
    current_at := clock_timestamp();
    local_at := current_at at time zone 'Asia/Seoul';
    local_hour := extract(hour from local_at);
  end if;

  if action in ('tick','status','accept','decline') then
    update private.live_jiwoo_calls set status = 'missed'
    where status = 'ringing' and expires_at <= current_at;
  end if;

  if action = 'tick' then
    select p.settings into settings from private.live_jiwoo_preferences p where singleton;
    if settings->>'incomingCalls' = 'false' or not (local_hour in (12,13,19,20,21))
      or exists (select 1 from private.live_jiwoo_calls where status = 'ringing'
        or (local_day = local_at::date and not requested))
      or exists (select 1 from private.live_presence where busy and seen_at > current_at - interval '90 seconds')
      or not (
        exists (select 1 from private.live_push_subscriptions)
        or exists (select 1 from private.live_voip_devices d where d.valid_until > current_at)
        or exists (select 1 from private.live_jiwoo_call_activity where last_open_at > current_at - interval '45 seconds')
      ) then
      return 'null'::jsonb;
    end if;

    period := settings->'workHours'->>extract(dow from local_at)::int;
    if coalesce(period, '') <> ''
      and local_at::time >= split_part(period, '-', 1)::time
      and local_at::time < split_part(period, '-', 2)::time then
      return 'null'::jsonb;
    end if;
    select quiet_start, quiet_end into quiet_from, quiet_until from private.live_preferences where id;
    if (quiet_from < quiet_until and local_hour >= quiet_from and local_hour < quiet_until)
      or (quiet_from > quiet_until and (local_hour >= quiet_from or local_hour < quiet_until)) then
      return 'null'::jsonb;
    end if;

    select to_timestamp((m.message->>'ts')::double precision / 1000)
    into last_message
    from private.live_chat_history h
    join private.live_message_events m on m.character_id = h.character_id and m.epoch = h.epoch
    where h.character_id = jiwoo and m.message->>'role' = 'user'
      and m.message->>'ts' ~ '^[0-9]{1,14}$'
    order by m.seq desc limit 1;
    if last_message is null or last_message < current_at - interval '48 hours'
      or last_message > current_at - interval '15 minutes'
      or exists (select 1 from private.live_jiwoo_calls where started_at > last_message) then
      return 'null'::jsonb;
    end if;

    insert into private.live_jiwoo_calls(started_at, expires_at, local_day)
    values(current_at, current_at + interval '75 seconds', local_at::date)
    on conflict do nothing returning * into call;
    if found then
      perform private.live_enqueue_jiwoo_call_push(call.id, call.expires_at);
    end if;
  elsif action = 'status' then
    update private.live_jiwoo_call_activity set last_open_at = current_at
      where singleton and last_open_at < current_at - interval '25 seconds';
    if call_id is null then
      select * into call from private.live_jiwoo_calls
      where status = 'ringing' order by started_at desc limit 1;
    else
      select * into call from private.live_jiwoo_calls where id = call_id;
    end if;
  elsif action in ('accept','decline') then
    update private.live_jiwoo_calls set status = case when action = 'accept' then 'accepted' else 'declined' end
    where id = call_id and status = 'ringing' and expires_at > clock_timestamp() returning * into call;
  elsif action = 'failed' then
    update private.live_jiwoo_calls set status = 'failed'
    where id = call_id and status = 'accepted' and greeted_at is null
      and started_at > current_at - interval '5 minutes' returning * into call;
  elsif action = 'greet' then
    update private.live_jiwoo_calls set greeted_at = current_at
    where id = call_id and status = 'accepted' and greeted_at is null
      and started_at > current_at - interval '5 minutes' returning * into call;
  elsif action = 'context' then
    select * into call from private.live_jiwoo_calls
    where started_at > current_at - interval '48 hours'
      and (status <> 'ringing' or expires_at <= current_at)
    order by started_at desc limit 1;
    if call.status = 'ringing' then call.status := 'missed'; end if;
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;

  if call.id is null then return 'null'::jsonb; end if;
  return jsonb_build_object('id',call.id,'characterId',jiwoo,'status',call.status,
    'startedAt',extract(epoch from call.started_at) * 1000,
    'expiresAt',extract(epoch from call.expires_at) * 1000);
end;
$$;

notify pgrst, 'reload schema';
