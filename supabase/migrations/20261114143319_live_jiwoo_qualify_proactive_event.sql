do $$
declare
  definition text;
  anchor text := 'and message->>''role'' = ''user''';
begin
  select pg_get_functiondef('public.live_jiwoo_proactive_work(text,text,jsonb)'::regprocedure) into definition;
  if position(anchor in definition) = 0 then raise exception 'Jiwoo user event clause not found'; end if;
  execute replace(definition, anchor, 'and live_message_events.message->>''role'' = ''user''');
end;
$$;
notify pgrst, 'reload schema';
