-- Run before enabling the new app code. Everything is rolled back; no user transcript is touched.
begin;
do $$
declare s jsonb; old_session text; guarded text; t bigint:=floor(extract(epoch from now())*1000)::bigint-5000; event jsonb;
begin
 if exists(select 1 from private.live_jiwoo_lock_state) then raise exception 'lifecycle test requires empty new store';end if;
 s:=private.jiwoo_lock_transition('read');
 if s->>'status'<>'empty' or s->>'version'<>'0' then raise exception 'empty state';end if;
 event:=jsonb_build_object('epoch',s->>'epoch','expected_version',0,'event_ms',t,'event_id','offline-test-1');
 s:=private.jiwoo_lock_transition('begin',event);old_session:=s->>'session_id';
 event:=event||jsonb_build_object('expected_version',s->'version','session_id',old_session,'cipher','v1.'||repeat('A',16)||'.'||repeat('B',22)||'.'||repeat('C',8));
 s:=private.jiwoo_lock_transition('store',event);
 if s->>'status'<>'active' or s->>'cipher' is null then raise exception 'store';end if;
 event:=event||jsonb_build_object('expected_version',s->'version','event_ms',t+1,'event_id','offline-disclose');
 s:=private.jiwoo_lock_transition('disclose',event);
 if s->>'status'<>'disclosed' or s->>'cipher' is null or s->>'disclosed_at' is null then raise exception 'disclose';end if;
 event:=event||jsonb_build_object('expected_version',s->'version','event_ms',t+2,'event_id','offline-new');
 s:=private.jiwoo_lock_transition('begin',event);
 if s->>'session_id'=old_session or s->>'cipher' is not null then raise exception 'new session must invalidate old code';end if;
 if not (private.jiwoo_lock_transition('store',event)->>'conflict')::boolean then raise exception 'stale write accepted';end if;
 event:=event||jsonb_build_object('expected_version',s->'version','session_id',s->>'session_id','event_ms',t+3,'event_id','offline-release');
 s:=private.jiwoo_lock_transition('release',event);
 if s->>'cipher' is not null or s->>'released_at' is null or s->>'status'<>'released' then raise exception 'release';end if;
 insert into private.live_reply_jobs(id,character_id,epoch,status,result,due_at)
 values(gen_random_uuid(),'8bda7b48-b3bc-4c8e-900b-7b92b04fe21c',(s->>'epoch')::uuid,'ready',jsonb_build_object('text','offline digits 0012','jiwooLockSession',old_session),now())
 returning result->>'text' into guarded;
 if guarded like '%0012%' then raise exception 'stale reply exposes old code';end if;
 if has_table_privilege('anon','private.live_jiwoo_lock_state','select') or has_function_privilege('anon','private.jiwoo_lock_transition(text,jsonb)','execute') then raise exception 'private data accessible';end if;
 begin
  perform public.live_jiwoo_lock_work('invalid','read','8bda7b48-b3bc-4c8e-900b-7b92b04fe21c','{}');
  raise exception 'invalid capability accepted';
 exception when invalid_authorization_specification then null;end;
end;$$;
rollback;
