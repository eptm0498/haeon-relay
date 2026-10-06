-- Recovery can leave an older sequence gap. Claim actual retained events,
-- never an empty numeric range, while keeping normal batches at 100 messages.
do $migration$
declare definition text;
begin
 definition=pg_get_functiondef('public.live_memory_work(text,text,uuid,uuid,uuid,text)'::regprocedure);
 definition=replace(definition,'if h.message_count-m.covered_count<100 or m.lease_until>now() then return null; end if;',
 'if h.message_count-m.covered_count<100 or m.lease_until>now() or not exists(select 1 from private.live_message_events where character_id=target_character and epoch=m.epoch and seq>m.covered_count) then return null; end if;');
 definition=replace(definition,'claimed_count=covered_count+100',
 'claimed_count=(select max(seq) from (select seq from private.live_message_events where character_id=target_character and epoch=m.epoch and seq>m.covered_count order by seq limit 100) available)');
 execute definition;
end;
$migration$;
notify pgrst,'reload schema';
