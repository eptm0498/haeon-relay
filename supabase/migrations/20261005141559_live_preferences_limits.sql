alter table private.live_preferences add column character_daily_cap integer not null default 2 check(character_daily_cap between 1 and 10);
do $patch$ declare definition text;begin
 definition=pg_get_functiondef('public.live_companion_work(text,text,uuid,uuid,jsonb,uuid)'::regprocedure);
 definition=replace(definition,'st.daily_count<2','st.daily_count<(select character_daily_cap from private.live_preferences where id)');execute definition;
 definition=pg_get_functiondef('public.live_data_work(text,text,uuid,jsonb)'::regprocedure);
 definition=replace(definition,'return (select to_jsonb(p) from private.live_preferences p where id);','return (select to_jsonb(p)||jsonb_build_object(''image_used_today'',(select count(*) from private.live_image_jobs where created_at>=date_trunc(''day'',now() at time zone ''Asia/Seoul'') at time zone ''Asia/Seoul'')) from private.live_preferences p where id);');
 definition=replace(definition,'image_daily_limit=(data->>''image_daily_limit'')::int,','image_daily_limit=(data->>''image_daily_limit'')::int,character_daily_cap=coalesce((data->>''character_daily_cap'')::int,character_daily_cap),');execute definition;
end $patch$;
notify pgrst,'reload schema';
create function public.live_server_characters(server_token text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.live_server_ok(server_token) then raise exception 'invalid capability' using errcode='28000';end if;
 return (select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.live_public_characters() c);
end $$;
revoke all on function public.live_server_characters(text) from public;
grant execute on function public.live_server_characters(text) to anon;
