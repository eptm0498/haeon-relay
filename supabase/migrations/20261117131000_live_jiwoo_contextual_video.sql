create table private.live_jiwoo_contextual_video_parts (
  position integer primary key check (position between 0 and 21),
  content bytea not null check (octet_length(content) between 1 and 48000)
);
alter table private.live_jiwoo_contextual_video_parts enable row level security;
revoke all on private.live_jiwoo_contextual_video_parts from public, anon, authenticated;

create function public.live_read_jiwoo_contextual_video(server_token text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  return (select case when count(*) = 22 and sum(octet_length(content)) = 1014204
    then encode(string_agg(content, ''::bytea order by position), 'base64')
  end from private.live_jiwoo_contextual_video_parts);
end;
$$;
revoke all on function public.live_read_jiwoo_contextual_video(text) from public, anon, authenticated;
grant execute on function public.live_read_jiwoo_contextual_video(text) to anon;
notify pgrst, 'reload schema';
