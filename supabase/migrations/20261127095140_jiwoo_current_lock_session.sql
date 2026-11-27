create table private.live_jiwoo_lock_state (
 character_id uuid primary key references public.live_characters(id) on delete cascade
  check(character_id='8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid),
 epoch uuid not null, session_id uuid not null default gen_random_uuid(),
 status text not null check(status in ('pending','active','disclosed','released')),
 cipher text, source_event_id text, event_id text not null, event_ms bigint not null,
 received_at timestamptz not null, disclosed_at timestamptz, released_at timestamptz,
 version integer not null default 1,
 check((status in ('pending','released') and cipher is null) or
       (status in ('active','disclosed') and cipher ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{4,16}$'))
);
alter table private.live_jiwoo_lock_state enable row level security;
revoke all on private.live_jiwoo_lock_state from public,anon,authenticated;

-- Private transition function allows transaction-only lifecycle tests without exposing a capability.
create function private.jiwoo_lock_transition(action text,data jsonb default '{}') returns jsonb
language plpgsql set search_path='' as $$
declare cid constant uuid:='8bda7b48-b3bc-4c8e-900b-7b92b04fe21c';
 h_epoch uuid; r private.live_jiwoo_lock_state%rowtype; ms bigint; eid text; current_state jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(7628301945071);
 select epoch into h_epoch from private.live_chat_history where character_id=cid;
 if h_epoch is null then raise exception 'missing conversation';end if;
 select * into r from private.live_jiwoo_lock_state where character_id=cid for update;
 if r.epoch is not null and r.epoch<>h_epoch then
  delete from private.live_jiwoo_lock_state where character_id=cid; r:=null;
 end if;
 current_state:=case when r.character_id is null then jsonb_build_object('epoch',h_epoch,'version',0,'status','empty') else to_jsonb(r) end;
 if action='read' then return current_state;end if;
 if data->>'epoch' is distinct from h_epoch::text or coalesce((data->>'expected_version')::integer,-1)<>coalesce(r.version,0) then
  return current_state||'{"conflict":true}'::jsonb;
 end if;
 ms:=(data->>'event_ms')::bigint; eid:=data->>'event_id';
 if ms is null or ms<0 or ms>extract(epoch from now())*1000+60000 or eid is null or length(eid)>120 then raise exception 'invalid event';end if;
 if r.event_ms is not null and ms<r.event_ms then return to_jsonb(r)||'{"conflict":true}'::jsonb;end if;
 if action='begin' then
  if r.source_event_id=eid then return to_jsonb(r);end if;
  insert into private.live_jiwoo_lock_state(character_id,epoch,status,event_id,source_event_id,event_ms,received_at)
   values(cid,h_epoch,'pending',eid,eid,ms,to_timestamp(ms/1000.0))
  on conflict(character_id) do update set epoch=h_epoch,session_id=gen_random_uuid(),status='pending',cipher=null,
   source_event_id=eid,event_id=eid,event_ms=ms,received_at=to_timestamp(ms/1000.0),disclosed_at=null,
   version=live_jiwoo_lock_state.version+1 returning * into r;
 elsif action in ('store','disclose','release') then
  if r.session_id is null or data->>'session_id' is distinct from r.session_id::text then return coalesce(to_jsonb(r),'{}')||'{"conflict":true}'::jsonb;end if;
  if action='store' then
   if r.status<>'pending' or r.source_event_id<>eid then return to_jsonb(r)||'{"conflict":true}'::jsonb;end if;
   update private.live_jiwoo_lock_state set cipher=data->>'cipher',status='active',version=version+1 where character_id=cid returning * into r;
  elsif action='disclose' then
   if r.status not in ('active','disclosed') then return to_jsonb(r)||'{"conflict":true}'::jsonb;end if;
   update private.live_jiwoo_lock_state set status='disclosed',disclosed_at=now(),event_id=eid,event_ms=ms,version=version+1 where character_id=cid returning * into r;
  else
   update private.live_jiwoo_lock_state set cipher=null,status='released',source_event_id=null,released_at=to_timestamp(ms/1000.0),event_id=eid,event_ms=ms,version=version+1 where character_id=cid returning * into r;
  end if;
 else raise exception 'invalid lock action';end if;
 if action in ('begin','release') then
  update private.live_reply_jobs set result=jsonb_set(result,'{text}',to_jsonb('잠금 기록이 바뀌었어. 번호가 필요하면 이번 기록으로 다시 확인할게.'::text))
   where character_id=cid and status='ready' and result ? 'jiwooLockSession';
 end if;
 return to_jsonb(r);
end;$$;
revoke all on function private.jiwoo_lock_transition(text,jsonb) from public,anon,authenticated;

create function public.live_jiwoo_lock_work(server_token text,action text,target_character uuid,data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.live_server_ok(server_token) then raise exception 'invalid server capability' using errcode='28000';end if;
 if target_character<>'8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid or target_character is null then raise exception 'invalid character';end if;
 return private.jiwoo_lock_transition(action,data);
end;$$;
revoke all on function public.live_jiwoo_lock_work(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.live_jiwoo_lock_work(text,text,uuid,jsonb) to anon;

create function private.jiwoo_lock_reply_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.character_id='8bda7b48-b3bc-4c8e-900b-7b92b04fe21c' and new.status='ready' and new.result ? 'jiwooLockSession'
  and not exists(select 1 from private.live_jiwoo_lock_state s where s.character_id=new.character_id and s.epoch=new.epoch
   and s.session_id::text=new.result->>'jiwooLockSession' and s.status in ('active','disclosed')) then
  new.result:=jsonb_set(new.result,'{text}',to_jsonb('이번 번호 기록이 바뀌었어. 현재 기록으로 다시 확인해 줘.'::text));
 end if;
 return new;
end;$$;
revoke all on function private.jiwoo_lock_reply_guard() from public,anon,authenticated;
create trigger jiwoo_lock_reply_guard before insert or update on private.live_reply_jobs for each row execute function private.jiwoo_lock_reply_guard();
