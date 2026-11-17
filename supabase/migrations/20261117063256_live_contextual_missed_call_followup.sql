alter table private.live_jiwoo_calls add column followup_claimed_at timestamptz;

-- The old worker can stay live during rollout. Both paths use followup_sent_at.
create function public.live_jiwoo_missed_call_work(
  server_token text, action text, call_id uuid default null, data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  current_at timestamptz := clock_timestamp();
  history private.live_chat_history%rowtype;
  attempt private.live_jiwoo_calls%rowtype;
  context jsonb;
  previous_lines jsonb;
  message jsonb;
  line text := btrim(coalesce(data->>'text',''));
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if action not in ('claim','send') or action is null then
    raise exception 'invalid missed call action' using errcode = '22023';
  end if;
  if action = 'claim' and not exists (
    select 1 from private.live_jiwoo_calls
    where followup_sent_at is null and status in ('ringing','missed')
      and expires_at <= current_at and expires_at > current_at - interval '24 hours'
      and (followup_claimed_at is null or followup_claimed_at < current_at - interval '60 seconds')
  ) then return null; end if;

  -- Match the lock order used by call creation and message delivery.
  select * into history from private.live_chat_history where character_id = jiwoo for update;
  if not found then return null; end if;
  if action = 'claim' then
    select * into attempt from private.live_jiwoo_calls
    where followup_sent_at is null and status in ('ringing','missed')
      and expires_at <= current_at and expires_at > current_at - interval '24 hours'
      and (followup_claimed_at is null or followup_claimed_at < current_at - interval '60 seconds')
    order by expires_at, id limit 1 for update skip locked;
    if not found then return null; end if;
    update private.live_jiwoo_calls set status = 'missed', followup_claimed_at = current_at where id = attempt.id;

    select coalesce(jsonb_agg(m order by ts), '[]') into context from (
      select m - 'image' - 'imagePrompt' as m, (m->>'ts')::numeric as ts
      from jsonb_array_elements(history.messages) m
      where (m->>'ts')::numeric >= extract(epoch from (attempt.started_at - interval '8 hours')) * 1000
        and m->>'role' in ('user','assistant') and coalesce(m->>'content','') <> ''
        and coalesce(m->>'id','') not like 'missed-call:%'
      order by ts desc limit 14
    ) context_rows;
    select coalesce(jsonb_agg(content), '[]') into previous_lines from (
      select left(m->>'content', 300) as content from jsonb_array_elements(history.messages) m
      where m->>'id' like 'missed-call:%' order by (m->>'ts')::numeric desc limit 12
    ) recent;
    return jsonb_build_object('id', attempt.id, 'lease', current_at, 'epoch', history.epoch,
      'startedAt', attempt.started_at, 'now', current_at, 'requested', attempt.requested,
      'messages', context, 'previousLines', previous_lines);
  end if;

  select * into attempt from private.live_jiwoo_calls where id = call_id for update;
  if not found or attempt.status <> 'missed' or attempt.followup_sent_at is not null
    or attempt.followup_claimed_at is null
    or attempt.followup_claimed_at is distinct from (data->>'lease')::timestamptz then return null; end if;
  if history.epoch::text is distinct from data->>'epoch' then
    update private.live_jiwoo_calls set followup_sent_at = current_at, followup_claimed_at = null where id = attempt.id;
    return null;
  end if;
  if char_length(line) not between 1 and 300 then
    raise exception 'invalid missed call text' using errcode = '22023';
  end if;
  message := jsonb_build_object('id', 'missed-call:' || attempt.id,
    'role','assistant','content',line,'ts',floor(extract(epoch from current_at) * 1000));
  perform public.live_sync_history(server_token, 'append', jiwoo, history.epoch, jsonb_build_array(message));
  insert into private.live_push_jobs(endpoint,message_id,payload)
    select endpoint,message->>'id',jsonb_build_object('title','지우','body',line,'characterId',jiwoo,'messageId',message->>'id')
    from private.live_push_subscriptions sub
    where not exists (
      select 1 from private.live_presence presence where presence.device_id = sub.device_id
        and presence.character_id = jiwoo and presence.seen_at > now() - interval '35 seconds'
    ) on conflict do nothing;
  update private.live_jiwoo_calls set followup_sent_at = current_at, followup_claimed_at = null where id = attempt.id;
  return 'true'::jsonb;
end;
$$;
revoke all on function public.live_jiwoo_missed_call_work(text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.live_jiwoo_missed_call_work(text,text,uuid,jsonb) to anon;
notify pgrst, 'reload schema';
