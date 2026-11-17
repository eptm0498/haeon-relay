create table private.live_jiwoo_pairing_codes (
  digest text primary key,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
alter table private.live_jiwoo_pairing_codes enable row level security;
revoke all on private.live_jiwoo_pairing_codes from public, anon, authenticated;

create function public.live_jiwoo_pairing_code(
  server_token text, pairing_digest text, authorization_digest text default null, pkce_challenge text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.live_server_ok(server_token), false) then
    raise exception 'invalid capability' using errcode = '28000';
  end if;
  if pairing_digest is null or pairing_digest !~ '^[a-f0-9]{64}$' then return false; end if;

  if authorization_digest is null and pkce_challenge is null then
    delete from private.live_jiwoo_pairing_codes where expires_at <= now();
    insert into private.live_jiwoo_pairing_codes(digest) values(pairing_digest);
    return true;
  end if;

  if coalesce(authorization_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(pkce_challenge, '') !~ '^[A-Za-z0-9_-]{43}$' then return false; end if;
  delete from private.live_jiwoo_pairing_codes where digest = pairing_digest and expires_at > now();
  if not found then return false; end if;
  delete from private.live_jiwoo_handoff_codes where expires_at <= now();
  insert into private.live_jiwoo_handoff_codes(digest, challenge) values(authorization_digest, pkce_challenge);
  return true;
end;
$$;
revoke all on function public.live_jiwoo_pairing_code(text,text,text,text) from public, anon, authenticated;
grant execute on function public.live_jiwoo_pairing_code(text,text,text,text) to anon;
notify pgrst, 'reload schema';
