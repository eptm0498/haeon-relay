-- Count user turns for Jiwoo. Keep paired replies and other events in the saved summary.
create function private.live_jiwoo_memory_boundary(target uuid, chat_epoch uuid, covered bigint)
returns bigint language sql stable set search_path = '' as $$
  with turns as (
    select seq from private.live_message_events
    where character_id = target and epoch = chat_epoch and seq > covered
      and message->>'role' = 'user'
    order by seq offset 49 limit 2
  )
  select case count(*)
    when 2 then (select max(seq) from private.live_message_events
      where character_id = target and epoch = chat_epoch and seq < (select max(seq) from turns))
    when 1 then (select max(seq) from private.live_message_events
      where character_id = target and epoch = chat_epoch)
  end from turns;
$$;
revoke all on function private.live_jiwoo_memory_boundary(uuid,uuid,bigint) from public, anon, authenticated;

do $$
declare
  definition text;
  original_gate text := 'if h.message_count-m.covered_count<100 or m.lease_until>now()';
  original_count text := 'claimed_count=(select max(seq) from (select seq from private.live_message_events where character_id=target_character and epoch=m.epoch and seq>m.covered_count order by seq limit 100) available)';
  original_due text := 'hist.message_count-coalesce(memo.covered_count,0)>=100';
  jiwoo text := quote_literal('8bda7b48-b3bc-4c8e-900b-7b92b04fe21c') || '::uuid';
begin
  select pg_get_functiondef('public.live_memory_work(text,text,uuid,uuid,uuid,text)'::regprocedure) into definition;
  if position(original_gate in definition)=0 or position(original_count in definition)=0 then
    raise exception 'memory claim clauses missing';
  end if;
  definition := replace(definition, 'batch jsonb;', 'batch jsonb; jiwoo_boundary bigint;');
  definition := replace(definition, original_gate,
    'if target_character=' || jiwoo || ' then jiwoo_boundary=private.live_jiwoo_memory_boundary(target_character,m.epoch,m.covered_count); end if; '
    || 'if (case when target_character=' || jiwoo || ' then jiwoo_boundary is null else h.message_count-m.covered_count<100 end) or m.lease_until>now()');
  definition := replace(definition, original_count, 'claimed_count=coalesce(jiwoo_boundary,' || substring(original_count from 15) || ')');
  execute definition;

  select pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure) into definition;
  if position(original_due in definition)=0 then raise exception 'memory due clause missing'; end if;
  definition := replace(definition, original_due, 'case when hist.character_id=' || jiwoo
    || ' then private.live_jiwoo_memory_boundary(hist.character_id,hist.epoch,case when memo.epoch=hist.epoch then memo.covered_count else 0 end) is not null else '
    || original_due || ' end');
  execute definition;
end;
$$;
notify pgrst, 'reload schema';
