-- Apply after the new server uses live_server_character. The editor link remains unchanged.
revoke execute on function public.live_read_character(uuid) from public,anon,authenticated;
revoke execute on function public.dokyeong_read_character() from public,anon,authenticated;
revoke all on public.live_characters,public.dokyeong_character_settings from anon,authenticated;
notify pgrst,'reload schema';
revoke execute on function public.live_public_characters() from public,anon,authenticated;
