alter table private.live_jiwoo_calls add column followup_sent_at timestamptz;
-- Existing missed calls predate this feature.
update private.live_jiwoo_calls set followup_sent_at = clock_timestamp()
where status = 'missed' or (status = 'ringing' and expires_at <= clock_timestamp());

create index live_jiwoo_followups_due on private.live_jiwoo_calls(expires_at)
where followup_sent_at is null and status in ('ringing', 'missed');

create function public.live_send_jiwoo_missed_call_toks(server_token text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  history_epoch uuid;
  attempt private.live_jiwoo_calls%rowtype;
  message jsonb;
  line text;
  sent integer := 0;
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if not exists (
    select 1 from private.live_jiwoo_calls
    where followup_sent_at is null and status in ('ringing','missed')
      and expires_at <= now() and expires_at > now() - interval '24 hours'
  ) then return 0; end if;

  -- Take the conversation lock first, matching the request and reply-delivery paths.
  select h.epoch into history_epoch from private.live_chat_history h where h.character_id = jiwoo for update;
  if not found then return 0; end if;
  update private.live_jiwoo_calls set status = 'missed'
    where status = 'ringing' and expires_at <= now();
  for attempt in
    select * from private.live_jiwoo_calls
    where followup_sent_at is null and status = 'missed'
      and expires_at <= now() and expires_at > now() - interval '24 hours'
    order by expires_at limit 5 for update skip locked
  loop
    line := (array[
      '이도혁, 내 전화 왜 안 받았어? 뭐 하고 있었는데.',
      '형, 나 전화했었거든? 뭐 하느라 못 받았어.',
      '야 이도혁, 전화 한 통 받기가 그렇게 어려워? 뭐 하고 있었는지 말해 봐 ㅋㅋ'
    ])[1 + get_byte(uuid_send(attempt.id), 15) % 3];
    message := jsonb_build_object('id', 'missed-call:' || attempt.id,
      'role', 'assistant', 'content', line, 'ts', floor(extract(epoch from clock_timestamp()) * 1000));
    perform public.live_sync_history(server_token, 'append', jiwoo, history_epoch, jsonb_build_array(message));
    insert into private.live_push_jobs(endpoint, message_id, payload)
      select endpoint, message->>'id', jsonb_build_object(
        'title','지우','body',line,'characterId',jiwoo,'messageId',message->>'id'
      ) from private.live_push_subscriptions sub
      where not exists (
        select 1 from private.live_presence presence where presence.device_id = sub.device_id
          and presence.character_id = jiwoo and presence.seen_at > now() - interval '35 seconds'
      ) on conflict do nothing;
    update private.live_jiwoo_calls set followup_sent_at = clock_timestamp() where id = attempt.id;
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;
revoke all on function public.live_send_jiwoo_missed_call_toks(text) from public, anon, authenticated;
grant execute on function public.live_send_jiwoo_missed_call_toks(text) to anon;

-- Use the existing 20-second background runner, including when all clients are closed.
do $$
declare
  definition text;
  early_exit text := 'then return null;end if;';
  wake_clause text := 'and not exists(select 1 from private.live_jiwoo_calls where followup_sent_at is null and status in (''ringing'',''missed'') and expires_at <= now() and expires_at > now() - interval ''24 hours'') ';
begin
  select pg_get_functiondef('private.live_reply_tick()'::regprocedure) into definition;
  if position(early_exit in definition)=0 then
    raise exception 'reply tick clauses missing';
  end if;
  definition := overlay(definition placing wake_clause from position(early_exit in definition) for 0);
  execute definition;
end;
$$;
notify pgrst, 'reload schema';
