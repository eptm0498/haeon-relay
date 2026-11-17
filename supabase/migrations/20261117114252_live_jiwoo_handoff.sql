create table private.live_jiwoo_handoff_state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0,
  source text check (source in ('live','chatgpt')),
  memo text not null default '',
  received boolean not null default false,
  live_context text not null default '',
  live_epoch uuid,
  live_message_id text
);
insert into private.live_jiwoo_handoff_state default values;
alter table private.live_jiwoo_handoff_state enable row level security;
revoke all on private.live_jiwoo_handoff_state from public, anon, authenticated;

create table private.live_jiwoo_handoff_codes (
  digest text primary key,
  challenge text not null,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
alter table private.live_jiwoo_handoff_codes enable row level security;
revoke all on private.live_jiwoo_handoff_codes from public, anon, authenticated;

create function public.live_jiwoo_handoff(server_token text, action text, data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jiwoo constant uuid := '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
  side text := data->>'source';
  note text := btrim(coalesce(data->>'memo', ''));
  state private.live_jiwoo_handoff_state%rowtype;
  context_epoch uuid;
  history jsonb;
  recent jsonb;
  marker text;
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if action = 'issue_code' then
    if coalesce(data->>'digest','') !~ '^[a-f0-9]{64}$'
      or coalesce(data->>'challenge','') !~ '^[A-Za-z0-9_-]{43}$' then return 'false'; end if;
    delete from private.live_jiwoo_handoff_codes where expires_at < now();
    insert into private.live_jiwoo_handoff_codes(digest, challenge) values(data->>'digest',data->>'challenge');
    return 'true';
  elsif action = 'consume_code' then
    delete from private.live_jiwoo_handoff_codes
    where digest = data->>'digest' and challenge = data->>'challenge' and expires_at > now();
    return to_jsonb(found);
  elsif action = 'context' then
    return (select to_jsonb(s.live_context) from private.live_jiwoo_handoff_state s
      join private.live_chat_history h on h.character_id = jiwoo and h.epoch = s.live_epoch
      where s.singleton and nullif(s.live_context,'') is not null);
  end if;
  if action is distinct from 'continue' or side is null or side not in ('live','chatgpt') then
    raise exception 'invalid handoff action' using errcode = '22023';
  end if;
  select epoch, messages into context_epoch, history from private.live_chat_history where character_id = jiwoo;
  select * into strict state from private.live_jiwoo_handoff_state s where s.singleton for update;
  if state.source is not null and side <> state.source and not state.received then
    if side = 'live' and context_epoch is null then
      return jsonb_build_object('status','empty');
    end if;
    if side = 'live' then
      select m->>'id' into marker from jsonb_array_elements(coalesce(history,'[]')) with ordinality x(m,n)
      where m->>'role' = 'user' order by n desc limit 1;
    end if;
    update private.live_jiwoo_handoff_state set
      received = true,
      live_context = case when side = 'live' then state.memo else state.live_context end,
      live_epoch = case when side = 'live' then context_epoch else state.live_epoch end,
      live_message_id = case when side = 'live' then marker else state.live_message_id end
    where singleton;
    return jsonb_build_object('status','received','memo',state.memo);
  end if;
  if note <> '' then
    if data->>'revision' is distinct from state.revision::text then return jsonb_build_object('status','retry'); end if;
    if side = 'live' and data->>'epoch' is distinct from context_epoch::text then
      return jsonb_build_object('status','retry');
    end if;
    if char_length(note) > 700 then raise exception 'memo too long' using errcode = '22023'; end if;
    if state.source = side and not state.received and state.memo = note then
      return jsonb_build_object('status','sent');
    end if;
    update private.live_jiwoo_handoff_state set revision = revision + 1, source = side, memo = note, received = false where singleton;
    return jsonb_build_object('status','sent');
  end if;
  if side = 'live' then
    select coalesce(jsonb_agg(message order by n), '[]') into recent from (
      select jsonb_build_object('role', m->>'role','content',left(m->>'content',800)) as message,n
      from jsonb_array_elements(coalesce(history,'[]')) with ordinality x(m,n)
      where m->>'role' in ('user','assistant') and nullif(btrim(m->>'content'),'') is not null
      order by n desc limit 18
    ) messages;
    if jsonb_array_length(recent) = 0 then return jsonb_build_object('status','empty'); end if;
    if state.source = 'chatgpt' and state.received and state.live_epoch = context_epoch then
      select m->>'id' into marker from jsonb_array_elements(coalesce(history,'[]')) with ordinality x(m,n)
      where m->>'role' = 'user' order by n desc limit 1;
      if marker is not distinct from state.live_message_id then return jsonb_build_object('status','ready'); end if;
    end if;
    return jsonb_build_object('status','summarize','revision',state.revision,'epoch',context_epoch,
      'messages',recent,'context',case when state.live_epoch = context_epoch then state.live_context else '' end);
  end if;
  return jsonb_build_object('status','summarize','revision',state.revision);
end;
$$;
revoke all on function public.live_jiwoo_handoff(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.live_jiwoo_handoff(text,text,jsonb) to anon;
notify pgrst, 'reload schema';
