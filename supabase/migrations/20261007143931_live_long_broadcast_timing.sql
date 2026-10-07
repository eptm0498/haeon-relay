-- Overnight broadcasts can last 14.5 hours. Keep a defensive 24-hour ceiling
-- for both text and voice activity, preserving the existing queue/lease logic.
do $patch$
declare definition text;
begin
 definition=pg_get_functiondef('public.live_reply_work(text,text,uuid,uuid,jsonb)'::regprocedure);
 if position('least(43200,' in definition)=0 then
  raise exception 'Expected reply timing bounds missing';
 end if;
 definition=replace(definition,'least(43200,','least(86400,');
 execute definition;
end $patch$;
notify pgrst,'reload schema';
