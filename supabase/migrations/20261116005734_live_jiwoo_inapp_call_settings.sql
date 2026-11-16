-- Share the existing call preference with the app. Old text-only saves keep it.
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
    if settings ? 'incomingCalls' and jsonb_typeof(settings->'incomingCalls') is distinct from 'boolean' then
      raise exception 'invalid Jiwoo call preference' using errcode = '22023';
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
      ) || case when settings ? 'incomingCalls' then jsonb_build_object('incomingCalls', settings->'incomingCalls')
        else '{}'::jsonb end;
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

notify pgrst, 'reload schema';
