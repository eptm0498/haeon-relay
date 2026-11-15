create or replace function public.live_jiwoo_preferences(access_token text, editor boolean, action text, settings jsonb default null, expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.live_jiwoo_preferences%rowtype;
begin
  if not coalesce(case when editor then private.live_editor_ok(access_token) else private.live_server_ok(access_token) end, false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if action = 'read' then
    select * into strict saved from private.live_jiwoo_preferences where singleton;
  elsif (action = 'save' and editor) or (action = 'save_proactive' and not editor) then
    if jsonb_typeof(settings) is distinct from 'object' then
      raise exception 'invalid Jiwoo preferences' using errcode = '22023';
    end if;
    if (settings ? 'proactiveTexts' and jsonb_typeof(settings->'proactiveTexts') is distinct from 'boolean')
      or (settings ? 'proactiveDailyStarts' and (
        jsonb_typeof(settings->'proactiveDailyStarts') is distinct from 'number'
        or settings->>'proactiveDailyStarts' !~ '^([1-9]|10)$'))
      or (settings ? 'proactiveSeriesMessages' and (
        jsonb_typeof(settings->'proactiveSeriesMessages') is distinct from 'number'
        or settings->>'proactiveSeriesMessages' !~ '^[1-5]$')) then
      raise exception 'invalid Jiwoo proactive text limits' using errcode = '22023';
    end if;

    if action = 'save_proactive' then
      if not (settings ?& array['proactiveTexts','proactiveDailyStarts','proactiveSeriesMessages']) then
        raise exception 'missing Jiwoo proactive text settings' using errcode = '22023';
      end if;
      settings := jsonb_build_object(
        'proactiveTexts', settings->'proactiveTexts',
        'proactiveDailyStarts', settings->'proactiveDailyStarts',
        'proactiveSeriesMessages', settings->'proactiveSeriesMessages'
      );
    elsif jsonb_typeof(settings->'workHours') is distinct from 'array'
      or jsonb_array_length(settings->'workHours') <> 7
      or exists (
        select 1 from jsonb_array_elements(settings->'workHours') as hours(value)
        where jsonb_typeof(value) <> 'string'
          or ((value #>> '{}') <> '' and (
            (value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'
            or split_part(value #>> '{}', '-', 1) >= split_part(value #>> '{}', '-', 2)))
      )
      or jsonb_typeof(settings->'chatPrompt') is distinct from 'string' or char_length(settings->>'chatPrompt') > 8000
      or jsonb_typeof(settings->'voicePrompt') is distinct from 'string' or char_length(settings->>'voicePrompt') > 8000
      or jsonb_typeof(settings->'scheduleNotes') is distinct from 'string' or char_length(settings->>'scheduleNotes') > 2000 then
      raise exception 'invalid Jiwoo preferences' using errcode = '22023';
    end if;
    update private.live_jiwoo_preferences p set settings = p.settings || live_jiwoo_preferences.settings, version = p.version + 1
      where singleton and p.version = expected_version returning * into saved;
    if not found then raise exception 'settings changed' using errcode = 'PT409'; end if;
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;
  return saved.settings || jsonb_build_object('version', saved.version);
end;
$$;

create or replace function public.live_jiwoo_proactive_work(server_token text, action text, data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  current_at timestamptz := clock_timestamp();
  local_day date := (current_at at time zone 'Asia/Seoul')::date;
  h private.live_chat_history%rowtype;
  state private.live_jiwoo_proactive_state%rowtype;
  prefs private.live_jiwoo_preferences%rowtype;
  can_call boolean;
  can_text boolean;
  last_user_seq bigint;
  day_start_count integer;
  daily_start_limit integer;
  series_message_limit integer;
  messages_in_series integer;
  series_waiting boolean;
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
  -- Serialize dispatch with settings changes. A claim needs only a snapshot.
  if action = 'finish' then
    select * into strict prefs from private.live_jiwoo_preferences where singleton for share;
  else
    select * into strict prefs from private.live_jiwoo_preferences where singleton;
  end if;
  can_call := private.live_jiwoo_call_allowed(prefs.settings, current_at);
  can_text := coalesce(prefs.settings->>'proactiveTexts', 'true') <> 'false';
  select ev.seq into last_user_seq from private.live_message_events ev
    where ev.character_id = jiwoo and ev.epoch = h.epoch and ev.message->>'role' = 'user'
    order by ev.seq desc limit 1;
  if last_user_seq is null then return 'null'::jsonb; end if;

  daily_start_limit := coalesce((prefs.settings->>'proactiveDailyStarts')::integer, 10);
  series_message_limit := coalesce((prefs.settings->>'proactiveSeriesMessages')::integer, 5);
  day_start_count := case when state.starts_day = local_day then state.starts_today else 0 end;
  messages_in_series := case when state.series_epoch = h.epoch and state.series_user_seq = last_user_seq
    and state.series_last_at > current_at - interval '1 hour' then state.series_sent else 0 end;
  -- An unanswered series stays open until it reaches its limit or goes quiet for an hour.
  series_waiting := messages_in_series > 0 and messages_in_series < series_message_limit;
  -- Leave slack around the five-minute cron tick so model latency doesn't delay each follow-up by a tick.
  can_text := can_text and (
    (series_waiting and state.series_last_at <= current_at - interval '4 minutes')
    or (messages_in_series = 0 and day_start_count < daily_start_limit)
  );

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
        and state.checked_at > current_at - case
          when can_text and series_waiting then interval '4 minutes' else interval '9 minutes' end)
      then return 'null'::jsonb; end if;

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
      'canText', can_text, 'seriesSent', case when series_waiting then messages_in_series else 0 end, 'messages', recent, 'calls', coalesce(calls, '[]'::jsonb),
      'prompt', (select prompt from public.live_characters where id = jiwoo),
      'memory', (select summary from private.live_memory where character_id = jiwoo and epoch = h.epoch));
  end if;

  if state.lease is null or state.lease is distinct from (data->>'lease')::uuid
    or state.leased_at <= current_at - interval '2 minutes' then return 'null'::jsonb; end if;

  update private.live_jiwoo_proactive_state
    set lease = null, leased_at = null,
      checked_at = case when choice = 'retry' then current_at - interval '5 minutes' else checked_at end
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
      set checked_count = (select message_count from private.live_chat_history where character_id = jiwoo),
        starts_day = local_day, starts_today = day_start_count + (messages_in_series = 0)::integer,
        series_epoch = h.epoch, series_user_seq = last_user_seq,
        series_sent = messages_in_series + 1, series_last_at = current_at
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

notify pgrst, 'reload schema';
