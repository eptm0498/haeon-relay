create function public.live_append_jiwoo_text(
  server_token text, target_character uuid, expected_epoch uuid, incoming jsonb, reply_to uuid, urgent boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved jsonb;
  latest_id text;
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid server capability' using errcode = '28000';
  end if;
  if target_character is distinct from '8bda7b48-b3bc-4c8e-900b-7b92b04fe21c'::uuid
    or reply_to is null or jsonb_typeof(incoming) is distinct from 'array'
    or jsonb_array_length(incoming) > 40
    or not exists (
      select 1 from jsonb_array_elements(incoming) as entry(message)
      where message->>'id' = reply_to::text and message->>'role' = 'user'
        and not (message ? 'image')
        and char_length(btrim(message->>'content')) between 1 and 1500
    ) then
    raise exception 'invalid Jiwoo text reply' using errcode = '22023';
  end if;

  -- Appending locks the conversation until the reply job is also registered.
  saved := public.live_sync_history(server_token, 'append', target_character, expected_epoch, incoming);
  select message_id into latest_id
    from private.live_message_events
    where character_id = target_character and epoch = expected_epoch
    order by seq desc limit 1;

  if latest_id = reply_to::text then
    perform public.live_reply_work(server_token, 'enqueue', reply_to, target_character, jsonb_build_object('urgent', coalesce(urgent, false)));
    return saved || jsonb_build_object('reply_job_id', reply_to);
  end if;

  return saved;
end;
$$;

revoke all on function public.live_append_jiwoo_text(text, uuid, uuid, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.live_append_jiwoo_text(text, uuid, uuid, jsonb, uuid, boolean) to anon;
notify pgrst, 'reload schema';
