do $$
begin
  if exists (select 1 from private.live_voip_devices) or exists (select 1 from private.live_voip_jobs) then
    raise exception 'native data is present';
  end if;
end;
$$;
drop trigger live_queue_voip_calls on private.live_jiwoo_calls;
drop function private.live_queue_voip_calls();
drop function public.live_voip_work(text,text,text,text,timestamptz,uuid,boolean,boolean);
drop table private.live_voip_jobs;
drop table private.live_voip_devices;
notify pgrst, 'reload schema';
create function private.live_ring_jiwoo_on_reply() returns trigger
language plpgsql set search_path = '' as $$
declare current_at timestamptz; call_id uuid; expires_at timestamptz;
begin
  -- The reply worker delivers the text and starts the call in the same transaction.
  perform pg_advisory_xact_lock(287319, 1);
  current_at := clock_timestamp();
  update private.live_jiwoo_calls set status = 'missed'
    where status = 'ringing' and private.live_jiwoo_calls.expires_at <= current_at;
  if not exists (select 1 from private.live_jiwoo_calls where status = 'ringing') then
    insert into private.live_jiwoo_calls(started_at, expires_at, local_day, requested)
    values(current_at, current_at + interval '75 seconds', (current_at at time zone 'Asia/Seoul')::date, true)
    returning id, live_jiwoo_calls.expires_at into call_id, expires_at;
    perform private.live_enqueue_jiwoo_call_push(call_id, expires_at);
  end if;
  return new;
end;
$$;
revoke all on function private.live_ring_jiwoo_on_reply() from public, anon, authenticated;

create trigger live_ring_jiwoo_on_reply after update of status on private.live_reply_jobs
  for each row when (
    old.status = 'ready' and new.status = 'complete'
    and old.character_id = '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid
    and old.result->'callNow' = 'true'::jsonb
  ) execute function private.live_ring_jiwoo_on_reply();

-- A call has its own push notification, so don't also send the preceding text as a push.
do $$
declare definition text; anchor text := 'where not exists(select 1 from private.live_presence presence';
begin
  select pg_get_functiondef('public.live_reply_work(text,text,uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(anchor in definition) = 0 then raise exception 'reply notification clause not found'; end if;
  execute replace(definition, anchor, 'where j.result->''callNow'' is distinct from ''true''::jsonb and not exists(select 1 from private.live_presence presence');
end;
$$;
notify pgrst, 'reload schema';
