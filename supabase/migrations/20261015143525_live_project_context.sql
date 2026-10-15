create table private.live_project_context (
 character_id uuid primary key references public.live_characters(id) on delete cascade,
 project_url text not null, source_url text not null, source_title text not null,
 messages jsonb not null default '[]', summary text not null default '',
 version integer not null default 1, content_hash text not null default '',
 partial boolean not null default true,
 updated_at timestamptz not null default now(), checked_at timestamptz not null default now(),
 check(jsonb_typeof(messages)='array' and jsonb_array_length(messages)<=3000),
 check(length(summary)<=8000)
);
alter table private.live_project_context enable row level security;
revoke all on private.live_project_context from public,anon,authenticated;

-- Existing server capability, never a client-provided anon role, authorizes
-- this narrow private-table operation just like the app's history RPCs.
create or replace function public.live_project_context(server_token text,target_character uuid,action text default 'read',data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved private.live_project_context%rowtype;
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid capability' using errcode='28000';end if;
 select * into saved from private.live_project_context where character_id=target_character for update;
 if not found then raise exception 'project not linked' using errcode='22023';end if;
 if action in ('check','save') then
  if saved.version is distinct from (data->>'version')::integer then raise exception 'project changed' using errcode='PT409';end if;
  if action='save' then
   if jsonb_typeof(data->'messages') is distinct from 'array' or jsonb_array_length(data->'messages')>3000 or length(data->>'summary')>8000 or coalesce(data->>'summary','')='' or length(data->>'content_hash')<>64 then raise exception 'invalid snapshot' using errcode='22023';end if;
   update private.live_project_context set messages=data->'messages',summary=data->>'summary',content_hash=data->>'content_hash',partial=coalesce((data->>'partial')::boolean,true),version=version+1,updated_at=now(),checked_at=now() where character_id=target_character returning * into saved;
  else
   update private.live_project_context set checked_at=now() where character_id=target_character returning * into saved;
  end if;
 elsif action<>'read' then raise exception 'invalid action' using errcode='22023';end if;
 return to_jsonb(saved)||jsonb_build_object('message_count',jsonb_array_length(saved.messages));
end $$;
revoke all on function public.live_project_context(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.live_project_context(text,uuid,text,jsonb) to anon;
