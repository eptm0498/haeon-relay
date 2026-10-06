-- PostgREST 14 retries custom SQLSTATE 40001 forever. These are application
-- conflicts, not database serialization failures: report HTTP 409 instead.
-- Preserve each existing function's signature, security settings and grants.
do $migration$
declare item record; definition text;
begin
  for item in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')
      and p.proname in ('live_sync_history_v1','dokyeong_save_character',
        'live_data_work','live_memory_work','live_save_character','live_sync_history')
      and p.prokind='f' and p.prosrc like '%40001%'
  loop
    definition=pg_get_functiondef(item.oid);
    execute replace(definition,'''40001''','''PT409''');
  end loop;
end;
$migration$;
notify pgrst, 'reload schema';
