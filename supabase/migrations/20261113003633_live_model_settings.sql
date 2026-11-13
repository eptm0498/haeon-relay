create table private.live_model_settings (
  singleton boolean primary key default true check (singleton),
  overrides jsonb not null default '{"textModel":null,"voiceModel":null,"speechModel":null,"transcriptionModel":null}',
  version integer not null default 1
);

alter table private.live_model_settings enable row level security;
revoke all on table private.live_model_settings from public, anon, authenticated;
insert into private.live_model_settings default values;

create function public.live_model_settings_work(
  server_token text,
  action text,
  settings jsonb default null,
  expected_version integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_settings private.live_model_settings%rowtype;
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid server capability' using errcode = '28000';
  end if;

  if action = 'read' then
    select * into strict current_settings from private.live_model_settings where singleton;
  elsif action = 'save' then
    if expected_version is null
      or jsonb_typeof(settings) is distinct from 'object'
      or not (settings ?& array['textModel', 'voiceModel', 'speechModel', 'transcriptionModel'])
      or exists (
        select 1 from jsonb_each(settings) as model(field, value)
        where field not in ('textModel', 'voiceModel', 'speechModel', 'transcriptionModel')
          or (jsonb_typeof(value) <> 'null' and (
            jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^[a-z][a-z0-9_.-]{0,63}$'
          ))
      ) then
      raise exception 'invalid model settings' using errcode = '22023';
    end if;

    update private.live_model_settings
      set overrides = settings, version = version + 1
      where singleton and version = expected_version
      returning * into current_settings;
    if not found then
      raise exception 'version conflict' using errcode = 'PT409';
    end if;
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;

  return jsonb_build_object('overrides', current_settings.overrides, 'version', current_settings.version);
end;
$$;

revoke all on function public.live_model_settings_work(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.live_model_settings_work(text, text, jsonb, integer) to anon;
