create or replace function public.live_jiwoo_call_work(server_token text, action text, call_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  current_at timestamptz := clock_timestamp();
  call private.live_jiwoo_calls%rowtype;
begin
  if not private.live_server_ok(server_token) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;

  if action in ('tick','status','accept','decline') then
    update private.live_jiwoo_calls set status = 'missed'
    where status = 'ringing' and expires_at <= current_at;
  end if;

  if action = 'tick' then
    -- Older deployments may still invoke tick while the contextual worker is rolling out.
    return 'null'::jsonb;
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

-- Update the original seed only. Preserve work hours saved in the editor.
update private.live_jiwoo_preferences
set settings = jsonb_set(settings, '{workHours}', '["08:40-22:00","16:00-22:00","","16:00-22:00","","","08:40-22:00"]'),
    version = version + 1
where singleton and version = 0
  and settings->'workHours' = '["09:00-21:00","16:00-21:00","","16:00-21:00","","","09:00-21:00"]';

drop index private.live_jiwoo_one_scheduled_call_per_day;

create function private.live_jiwoo_call_allowed(settings jsonb, instant timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(settings->>'incomingCalls', 'true') <> 'false'
    and not coalesce(
      local_at::time >= nullif(split_part(period, '-', 1), '')::time
        and local_at::time < nullif(split_part(period, '-', 2), '')::time,
      false
    )
  from (select instant at time zone 'Asia/Seoul' as local_at) as local_clock
  cross join lateral (select settings->'workHours'->>extract(dow from local_at)::int as period) as shift;
$$;

create function private.live_jiwoo_contact_available(instant timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from private.live_jiwoo_calls where status = 'ringing' and expires_at > instant
    ) and not exists (
      select 1 from private.live_presence where busy and seen_at > instant - interval '90 seconds'
    );
$$;

create function private.live_start_jiwoo_context_call()
returns uuid language plpgsql set search_path = '' as $$
declare current_at timestamptz; call_id uuid; call_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(287319, 1);
  current_at := clock_timestamp();
  if not exists (
    select 1 from private.live_jiwoo_preferences p
    where p.singleton and private.live_jiwoo_call_allowed(p.settings, current_at)
  ) or not private.live_jiwoo_contact_available(current_at) then return null; end if;

  update private.live_jiwoo_calls set status = 'missed'
    where status = 'ringing' and expires_at <= current_at;
  insert into private.live_jiwoo_calls(started_at, expires_at, local_day, requested)
  values(current_at, current_at + interval '75 seconds', (current_at at time zone 'Asia/Seoul')::date, false)
  returning id, expires_at into call_id, call_expires_at;
  perform private.live_enqueue_jiwoo_call_push(call_id, call_expires_at);
  return call_id;
end;
$$;

create or replace function private.live_ring_jiwoo_on_reply() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.live_start_jiwoo_context_call();
  return new;
end;
$$;

revoke all on function private.live_jiwoo_call_allowed(jsonb,timestamptz),
  private.live_jiwoo_contact_available(timestamptz), private.live_start_jiwoo_context_call()
from public, anon, authenticated;

-- A generated reply can cross a schedule boundary before delivery.
do $$
declare
  definition text;
  anchor text := 'msg=jsonb_build_object(''id'',''reply:''||j.id';
begin
  select pg_get_functiondef('public.live_reply_work(text,text,uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(anchor in definition) = 0 then raise exception 'reply delivery clause not found'; end if;
  execute replace(definition, anchor, $code$
    if j.character_id='8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid and j.result->'callNow'='true'::jsonb then
     perform pg_advisory_xact_lock(287319, 1);
     if not exists(select 1 from private.live_jiwoo_preferences p where p.singleton and private.live_jiwoo_call_allowed(p.settings,clock_timestamp()))
       or not private.live_jiwoo_contact_available(clock_timestamp()) then
      j.result=(j.result - 'callNow')||jsonb_build_object('text','지금은 문자로 얘기하자, 형.');
      update private.live_reply_jobs set result=j.result where id=j.id;
     end if;
    end if;
    $code$ || anchor);
end;
$$;

create table private.live_jiwoo_proactive_state (
  singleton boolean primary key default true check (singleton),
  lease uuid,
  leased_at timestamptz,
  checked_at timestamptz,
  checked_epoch uuid,
  checked_count bigint
);
insert into private.live_jiwoo_proactive_state default values;
alter table private.live_jiwoo_proactive_state enable row level security;
revoke all on private.live_jiwoo_proactive_state from public, anon, authenticated;

create function public.live_jiwoo_proactive_work(server_token text, action text, data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  current_at timestamptz := clock_timestamp();
  h private.live_chat_history%rowtype;
  state private.live_jiwoo_proactive_state%rowtype;
  prefs private.live_jiwoo_preferences%rowtype;
  can_call boolean;
  can_text boolean;
  reachable boolean;
  pending_reply boolean;
  choice text := data->>'choice';
  reply_text text := btrim(data->>'text');
  message jsonb;
  recent jsonb;
  calls jsonb;
begin
  if not private.live_server_ok(server_token) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if action not in ('claim', 'finish') or action is null then
    raise exception 'invalid action' using errcode = '22023';
  end if;

  select * into h from private.live_chat_history where character_id = jiwoo for update skip locked;
  if not found then return 'null'::jsonb; end if;
  select * into state from private.live_jiwoo_proactive_state where singleton for update;
  select * into strict prefs from private.live_jiwoo_preferences where singleton;
  can_call := private.live_jiwoo_call_allowed(prefs.settings, current_at);
  can_text := coalesce(prefs.settings->>'proactiveTexts', 'true') <> 'false';
  reachable := exists (select 1 from private.live_push_subscriptions)
    or exists (select 1 from private.live_jiwoo_call_activity where last_open_at > current_at - interval '45 seconds');
  pending_reply := exists (
    select 1 from private.live_reply_jobs where character_id = jiwoo and epoch = h.epoch
      and kind = 'reply' and status in ('queued', 'generating', 'ready')
  );

  if action = 'claim' then
    if state.lease is not null and state.leased_at > current_at - interval '2 minutes'
      or not (can_text or can_call) or not reachable or pending_reply
      or not private.live_jiwoo_contact_available(current_at)
      or (state.checked_epoch = h.epoch and state.checked_count = h.message_count
        and state.checked_at > current_at - interval '30 minutes')
      or not exists (
        select 1 from private.live_message_events
        where character_id = jiwoo and epoch = h.epoch and message->>'role' = 'user'
      ) then return 'null'::jsonb; end if;

    update private.live_jiwoo_proactive_state set lease = gen_random_uuid(), leased_at = current_at,
      checked_at = current_at, checked_epoch = h.epoch, checked_count = h.message_count
      where singleton returning * into state;
    select jsonb_agg(event.message order by event.seq) into recent from (
      select seq, m.message from private.live_message_events m where character_id = jiwoo
        and epoch = h.epoch order by seq desc limit 24
    ) event;
    select jsonb_agg(jsonb_build_object('at', started_at, 'status', status) order by started_at desc)
      into calls from (
        select started_at, case when status = 'ringing' then 'missed' else status end as status
        from private.live_jiwoo_calls where started_at > current_at - interval '48 hours'
        order by started_at desc limit 5
      ) recent_calls;
    return jsonb_build_object('lease', state.lease, 'now', current_at, 'settings',
      prefs.settings || jsonb_build_object('version', prefs.version), 'canCall', can_call,
      'canText', can_text, 'messages', recent, 'calls', coalesce(calls, '[]'::jsonb),
      'prompt', (select prompt from public.live_characters where id = jiwoo),
      'memory', (select summary from private.live_memory where character_id = jiwoo and epoch = h.epoch));
  end if;

  if state.lease is null or state.lease is distinct from (data->>'lease')::uuid
    or state.leased_at <= current_at - interval '2 minutes' then return 'null'::jsonb; end if;

  update private.live_jiwoo_proactive_state
    set lease = null, leased_at = null,
      checked_at = case when choice = 'retry' then current_at - interval '25 minutes' else checked_at end
    where singleton;
  if state.checked_epoch is distinct from h.epoch or state.checked_count is distinct from h.message_count
    or not reachable or pending_reply or not private.live_jiwoo_contact_available(current_at)
    or exists (select 1 from private.live_jiwoo_calls where started_at >= state.leased_at)
    then return 'null'::jsonb; end if;

  if choice = 'call' and can_call then
    if private.live_start_jiwoo_context_call() is not null then return '"call"'::jsonb; end if;
  elsif choice = 'text' and can_text and char_length(reply_text) between 1 and 500 then
    message := jsonb_build_object('id', gen_random_uuid(), 'role', 'assistant', 'content', reply_text,
      'ts', floor(extract(epoch from clock_timestamp()) * 1000), 'proactive', true);
    perform public.live_sync_history(server_token, 'append', jiwoo, h.epoch, jsonb_build_array(message));
    update private.live_jiwoo_proactive_state
      set checked_count = (select message_count from private.live_chat_history where character_id = jiwoo)
      where singleton;
    insert into private.live_push_jobs(endpoint, message_id, payload)
    select sub.endpoint, message->>'id', jsonb_build_object(
      'title', '지우', 'body', reply_text, 'characterId', jiwoo, 'messageId', message->>'id'
    ) from private.live_push_subscriptions sub
    where not exists (
      select 1 from private.live_presence presence where presence.device_id = sub.device_id
        and presence.character_id = jiwoo and presence.seen_at > current_at - interval '35 seconds'
    ) on conflict do nothing;
    return '"text"'::jsonb;
  end if;
  return 'null'::jsonb;
end;
$$;

revoke all on function public.live_jiwoo_proactive_work(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.live_jiwoo_proactive_work(text,text,jsonb) to anon;

notify pgrst, 'reload schema';
