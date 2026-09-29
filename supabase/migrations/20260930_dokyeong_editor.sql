create schema if not exists private;

create table if not exists private.dokyeong_editor_key (
  id integer primary key default 1 check (id = 1),
  token_hash text not null
);
revoke all on private.dokyeong_editor_key from public, anon, authenticated;

create table if not exists public.dokyeong_character_settings (
  id integer primary key default 1 check (id = 1),
  prompt text not null check (char_length(prompt) between 100 and 30000),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.dokyeong_character_settings enable row level security;
revoke all on public.dokyeong_character_settings from anon, authenticated;

create or replace function public.dokyeong_read_character()
returns table(prompt text, version integer, updated_at timestamptz)
language sql security definer set search_path = ''
as $$
  select s.prompt, s.version, s.updated_at
  from public.dokyeong_character_settings s where s.id = 1;
$$;

create or replace function public.dokyeong_verify_editor(edit_token text)
returns boolean
language sql security definer set search_path = ''
as $$
  select coalesce(char_length(edit_token) = 64 and exists (
    select 1 from private.dokyeong_editor_key k
    where k.id = 1 and k.token_hash = encode(extensions.digest(edit_token, 'sha256'), 'hex')
  ), false);
$$;

create or replace function public.dokyeong_save_character(
  edit_token text, new_prompt text, expected_version integer
)
returns table(version integer, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare current_version integer;
begin
  if edit_token is null or char_length(edit_token) != 64 or not exists (
    select 1 from private.dokyeong_editor_key k
    where k.id = 1 and k.token_hash = encode(extensions.digest(edit_token, 'sha256'), 'hex')
  ) then
    raise exception 'invalid editor link' using errcode = '28000';
  end if;
  if new_prompt is null or char_length(new_prompt) not between 100 and 30000 then
    raise exception 'prompt length invalid' using errcode = '22023';
  end if;

  select s.version into current_version from public.dokyeong_character_settings s where s.id = 1 for update;
  if current_version is distinct from expected_version then
    raise exception 'settings changed elsewhere' using errcode = '40001';
  end if;

  if current_version is null then
    insert into public.dokyeong_character_settings(id, prompt) values (1, new_prompt);
  else
    update public.dokyeong_character_settings s
      set prompt = new_prompt, version = s.version + 1, updated_at = now()
      where s.id = 1;
  end if;
  return query select s.version, s.updated_at from public.dokyeong_character_settings s where s.id = 1;
end;
$$;

revoke all on function public.dokyeong_read_character() from public;
revoke all on function public.dokyeong_verify_editor(text) from public;
revoke all on function public.dokyeong_save_character(text, text, integer) from public;
grant execute on function public.dokyeong_read_character() to anon;
grant execute on function public.dokyeong_verify_editor(text) to anon;
grant execute on function public.dokyeong_save_character(text, text, integer) to anon;
