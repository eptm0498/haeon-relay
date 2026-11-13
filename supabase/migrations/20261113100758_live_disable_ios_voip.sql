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

create or replace function private.live_queue_voip_calls() returns trigger language plpgsql set search_path = '' as $$
begin
  return new;
end;
$$;
notify pgrst, 'reload schema';
