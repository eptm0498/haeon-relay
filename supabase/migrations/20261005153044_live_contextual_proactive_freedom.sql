alter table private.live_preferences drop constraint live_preferences_daily_cap_check,drop constraint live_preferences_character_daily_cap_check,drop constraint live_preferences_interval_hours_check;
alter table private.live_preferences add constraint live_preferences_daily_cap_check check(daily_cap between 1 and 100),add constraint live_preferences_character_daily_cap_check check(character_daily_cap between 1 and 50),add constraint live_preferences_interval_hours_check check(interval_hours between 0 and 24);
alter table private.live_preferences alter column daily_cap set default 40,alter column character_daily_cap set default 20,alter column interval_hours set default 0,alter column quiet_start set default 0,alter column quiet_end set default 0;
update private.live_preferences set daily_cap=40,character_daily_cap=20,interval_hours=0,quiet_start=0,quiet_end=0,version=version+1 where id;
do $patch$ declare definition text;begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 if position('now()-make_interval(hours=>(select interval_hours from private.live_preferences where id))' in definition)=0 or position('interval ''30 minutes''' in definition)=0 then raise exception 'unexpected companion timing definition';end if;
 definition=replace(definition,'now()-make_interval(hours=>(select interval_hours from private.live_preferences where id))','now()-greatest(interval ''15 minutes'',make_interval(hours=>(select interval_hours from private.live_preferences where id)))');
 definition=replace(definition,'interval ''30 minutes''','interval ''10 minutes''');
 definition=replace(definition,'else interval ''1 hour'' end','else interval ''15 minutes'' end');
 execute definition;
end $patch$;
notify pgrst,'reload schema';
