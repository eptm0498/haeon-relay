create table private.live_jiwoo_video_parts (
  position integer primary key check (position >= 0),
  content bytea not null
);
alter table private.live_jiwoo_video_parts enable row level security;
revoke all on private.live_jiwoo_video_parts from public, anon, authenticated;

create function public.live_read_jiwoo_video(server_token text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.live_server_ok(server_token) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  return (select case when count(*) = 16 and sum(octet_length(content)) = 756863
    then encode(string_agg(content, ''::bytea order by position), 'base64')
  end from private.live_jiwoo_video_parts);
end;
$$;
revoke all on function public.live_read_jiwoo_video(text) from public, anon, authenticated;
grant execute on function public.live_read_jiwoo_video(text) to anon;

do $$
declare
  definition text;
  delay_clause text := 'delay=greatest(5,least(86400,(data->>''delaySeconds'')::int))';
  enqueue_clause text := 'a.until_at>now() and coalesce(data->>''urgent'',''false'')<>''true'' then a.until_at';
begin
  select pg_get_functiondef('public.live_reply_work(text,text,uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(delay_clause in definition) = 0 or position(enqueue_clause in definition) = 0 then
    raise exception 'reply timing clauses missing';
  end if;
  definition := replace(definition, delay_clause, 'delay=greatest(case when j.character_id=''8bda7b48-b3bc-4c8e-900b-7b92b04fe21c''::uuid and j.kind=''reply'' then 0 else 5 end,least(86400,(data->>''delaySeconds'')::int))');
  definition := replace(definition, enqueue_clause, 'target_character<>''8bda7b48-b3bc-4c8e-900b-7b92b04fe21c''::uuid and ' || enqueue_clause);
  execute definition;
end;
$$;
notify pgrst, 'reload schema';
