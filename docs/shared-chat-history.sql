create table if not exists private.live_history_key (id boolean primary key default true check(id), key_hash text not null);
alter table private.live_history_key enable row level security;
insert into private.live_history_key(id,key_hash) values(true,'ca0e0898ff9003f31cca61a75b6629deed2e027aff3c0f3d4d6ee87993e50a62') on conflict(id) do update set key_hash=excluded.key_hash;
create table if not exists private.live_chat_history (
 character_id uuid primary key references public.live_characters(id) on delete cascade,
 epoch uuid not null default gen_random_uuid(),
 messages jsonb not null default '[]'::jsonb,
 import_allowed boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table private.live_chat_history enable row level security;
revoke all on private.live_history_key, private.live_chat_history from public, anon, authenticated;

create or replace function public.live_sync_history(server_token text, action text default 'read', target_character uuid default null, expected_epoch uuid default null, incoming jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row_value private.live_chat_history%rowtype;
declare result jsonb;
begin
 if not exists(select 1 from private.live_history_key where key_hash=encode(extensions.digest(server_token,'sha256'),'hex')) then
  raise exception 'invalid history capability' using errcode='28000';
 end if;
 if action='read' then
  insert into private.live_chat_history(character_id) select id from public.live_characters on conflict do nothing;
  select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) into result from private.live_chat_history h;
  return result;
 end if;
 if target_character is null or action not in ('append','import','reset') then raise exception 'invalid action' using errcode='22023'; end if;
 select * into row_value from private.live_chat_history where character_id=target_character for update;
 if not found then raise exception 'history not initialized' using errcode='22023'; end if;
 if row_value.epoch is distinct from expected_epoch then raise exception 'conversation changed' using errcode='40001'; end if;
 if action='reset' then
  update private.live_chat_history set messages='[]'::jsonb,epoch=gen_random_uuid(),import_allowed=false,updated_at=now() where character_id=target_character returning * into row_value;
  return to_jsonb(row_value);
 end if;
 if action='import' and not row_value.import_allowed then return to_jsonb(row_value); end if;
 if jsonb_typeof(incoming)<>'array' or jsonb_array_length(incoming)>40 then raise exception 'invalid messages' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(incoming) m where coalesce(m->>'id','')='' or length(m->>'id')>120 or coalesce(m->>'role','') not in ('user','assistant') or jsonb_typeof(m->'content')<>'string' or jsonb_typeof(m->'ts')<>'number') then raise exception 'invalid message' using errcode='22023'; end if;
 select coalesce(jsonb_agg(m order by (m->>'ts')::numeric,m->>'id'),'[]'::jsonb) into result
 from (
  select m from (
   select distinct on (m->>'id') m from jsonb_array_elements(row_value.messages || incoming) m order by m->>'id'
  ) dedup order by (m->>'ts')::numeric desc,m->>'id' desc limit 1000
 ) recent;
 update private.live_chat_history set messages=result,updated_at=now() where character_id=target_character returning * into row_value;
 return to_jsonb(row_value);
end $$;
revoke all on function public.live_sync_history(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.live_sync_history(text,text,uuid,uuid,jsonb) to anon;

