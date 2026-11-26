do $migration$
declare definition text;
begin
  select pg_get_functiondef('public.live_jiwoo_preferences(text,boolean,text,jsonb,integer)'::regprocedure) into definition;
  if position('settings->>''proactiveDailyStarts'' !~ ''^([1-9]|10)$''' in definition) = 0 then
    raise exception 'Expected daily count validation missing';
  end if;
  definition := replace(definition,
    'settings->>''proactiveDailyStarts'' !~ ''^([1-9]|10)$''',
    '(settings->>''proactiveDailyStarts'' !~ ''^[1-9][0-9]*$'' or (settings->>''proactiveDailyStarts'')::numeric > 2147483647)');
  execute definition;
end;
$migration$;
