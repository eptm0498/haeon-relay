create function public.live_save_jiwoo_prompt(server_token text, new_prompt text, expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved jsonb;
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;

  if new_prompt is null or char_length(btrim(new_prompt)) < 100
      or char_length(new_prompt) > 30000 or expected_version is null
      or expected_version not between 1 and 2147483646 then
    raise exception 'invalid character settings' using errcode = '22023';
  end if;

  update public.live_characters as c
  set prompt = new_prompt, version = c.version + 1, updated_at = now()
  where c.id = '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid and c.version = expected_version
  returning jsonb_build_object('prompt', c.prompt, 'version', c.version) into saved;

  if not found then
    raise exception 'settings changed elsewhere' using errcode = 'PT409';
  end if;
  return saved;
end;
$$;

revoke all on function public.live_save_jiwoo_prompt(text, text, integer) from public, anon, authenticated;
grant execute on function public.live_save_jiwoo_prompt(text, text, integer) to anon;
notify pgrst, 'reload schema';
