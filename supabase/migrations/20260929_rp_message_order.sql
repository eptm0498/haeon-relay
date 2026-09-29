-- Assign a conversation-local order when clients insert an RP message.
create function public.rp_assign_message_ordinal() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
 if new.ordinal is null then
  select coalesce(max(m.ordinal),0)+1 into new.ordinal
  from public.rp_messages m where m.session_id = new.session_id;
 end if;
 return new;
end;
$$;
revoke execute on function public.rp_assign_message_ordinal() from public, anon, authenticated;
create trigger rp_message_ordinal before insert on public.rp_messages
for each row execute function public.rp_assign_message_ordinal();
create unique index rp_messages_session_ordinal_key on public.rp_messages(session_id,ordinal);
