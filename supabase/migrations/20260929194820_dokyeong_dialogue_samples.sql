create schema if not exists private;
create table if not exists private.dokyeong_editor_key (
  id integer primary key default 1 check (id = 1), token_hash text not null
);
revoke all on private.dokyeong_editor_key from public, anon, authenticated;

create table if not exists private.dokyeong_sample_reader_key (
  id integer primary key default 1 check (id = 1), token_hash text not null
);
alter table private.dokyeong_sample_reader_key enable row level security;
revoke all on private.dokyeong_sample_reader_key from public, anon, authenticated;

create table if not exists private.dokyeong_dialogue_samples (
  id uuid primary key default gen_random_uuid(),
  source_hash text unique,
  cue text not null check (char_length(cue) between 2 and 700),
  reply text not null check (char_length(reply) between 1 and 900),
  spoken text not null check (char_length(spoken) between 1 and 900),
  category text not null check (category in ('일상','장난','애정','위로','갈등','생각','잠/생활','기타')),
  quality integer not null default 50 check (quality between 0 and 100),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dokyeong_dialogue_samples_category_quality
  on private.dokyeong_dialogue_samples(category, quality desc) where enabled;
alter table private.dokyeong_dialogue_samples enable row level security;
revoke all on private.dokyeong_dialogue_samples from public, anon, authenticated;

create or replace function private.dokyeong_sample_editor_ok(edit_token text)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce(char_length(edit_token) = 64 and exists (
    select 1 from private.dokyeong_editor_key k
    where k.id = 1 and k.token_hash = encode(extensions.digest(edit_token, 'sha256'), 'hex')
  ), false);
$$;
revoke all on function private.dokyeong_sample_editor_ok(text) from public, anon, authenticated;

create or replace function public.dokyeong_register_sample_reader(edit_token text, reader_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.dokyeong_sample_editor_ok(edit_token) then
    raise exception 'invalid editor link' using errcode = '28000';
  end if;
  if reader_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid reader key' using errcode = '22023';
  end if;
  insert into private.dokyeong_sample_reader_key(id, token_hash) values (1, reader_hash)
    on conflict (id) do update set token_hash = excluded.token_hash;
  return true;
end;
$$;

create or replace function public.dokyeong_list_samples(edit_token text, page_number integer default 0, search_text text default '', state_filter text default 'all')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare total_count integer; items jsonb;
begin
  if not private.dokyeong_sample_editor_ok(edit_token) then
    raise exception 'invalid editor link' using errcode = '28000';
  end if;
  if page_number < 0 or page_number > 10000 or char_length(search_text) > 100
    or state_filter not in ('all', 'on', 'off') then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;
  select count(*) into total_count from private.dokyeong_dialogue_samples s
    where (state_filter = 'all' or s.enabled = (state_filter = 'on'))
      and (search_text = '' or s.cue ilike '%' || search_text || '%'
      or s.reply ilike '%' || search_text || '%' or s.category ilike '%' || search_text || '%');
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc, s.id), '[]'::jsonb) into items
    from (select id, cue, reply, spoken, category, quality, enabled, created_at, updated_at
      from private.dokyeong_dialogue_samples
      where (state_filter = 'all' or enabled = (state_filter = 'on'))
        and (search_text = '' or cue ilike '%' || search_text || '%'
        or reply ilike '%' || search_text || '%' or category ilike '%' || search_text || '%')
      order by created_at desc, id limit 40 offset page_number * 40) s;
  return jsonb_build_object('items', items, 'total', total_count);
end;
$$;

create or replace function public.dokyeong_save_sample(
  edit_token text, sample_id uuid, sample_cue text, sample_reply text,
  sample_spoken text, sample_category text, sample_enabled boolean default true
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result private.dokyeong_dialogue_samples%rowtype;
begin
  if not private.dokyeong_sample_editor_ok(edit_token) then
    raise exception 'invalid editor link' using errcode = '28000';
  end if;
  if char_length(sample_cue) not between 2 and 700 or char_length(sample_reply) not between 1 and 900
    or char_length(sample_spoken) not between 1 and 900
    or sample_category not in ('일상','장난','애정','위로','갈등','생각','잠/생활','기타') then
    raise exception 'invalid sample' using errcode = '22023';
  end if;
  if sample_id is null then
    insert into private.dokyeong_dialogue_samples(cue, reply, spoken, category, enabled)
      values(sample_cue, sample_reply, sample_spoken, sample_category, coalesce(sample_enabled, true))
      returning * into result;
  else
    update private.dokyeong_dialogue_samples
      set cue = sample_cue, reply = sample_reply, spoken = sample_spoken,
          category = sample_category, enabled = coalesce(sample_enabled, true), updated_at = now()
      where id = sample_id returning * into result;
    if not found then raise exception 'sample not found' using errcode = '22023'; end if;
  end if;
  return to_jsonb(result) - 'source_hash';
end;
$$;

create or replace function public.dokyeong_delete_sample(edit_token text, sample_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.dokyeong_sample_editor_ok(edit_token) then
    raise exception 'invalid editor link' using errcode = '28000';
  end if;
  delete from private.dokyeong_dialogue_samples where id = sample_id;
  return found;
end;
$$;

create or replace function public.dokyeong_import_samples(edit_token text, samples jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  if not private.dokyeong_sample_editor_ok(edit_token) then
    raise exception 'invalid editor link' using errcode = '28000';
  end if;
  if jsonb_typeof(samples) <> 'array' or jsonb_array_length(samples) > 400 then
    raise exception 'invalid sample batch' using errcode = '22023';
  end if;
  insert into private.dokyeong_dialogue_samples(source_hash, cue, reply, spoken, category, quality, enabled)
    select x->>'source_hash', x->>'cue', x->>'reply', x->>'spoken', x->>'category', (x->>'quality')::integer,
      coalesce((x->>'enabled')::boolean, false)
      from jsonb_array_elements(samples) x
      where (x->>'source_hash') ~ '^[a-f0-9]{64}$'
        and char_length(x->>'cue') between 2 and 700
        and char_length(x->>'reply') between 1 and 900
        and char_length(x->>'spoken') between 1 and 900
        and x->>'category' in ('일상','장난','애정','위로','갈등','생각','잠/생활','기타')
        and (x->>'quality')::integer between 0 and 100
      on conflict(source_hash) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.dokyeong_match_samples(reader_token text, sample_category text, cue_term text)
returns table(id uuid, cue text, reply text, spoken text, category text, quality integer)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.dokyeong_sample_reader_key k
    where k.id = 1 and k.token_hash = encode(extensions.digest(reader_token, 'sha256'), 'hex')
  ) then
    raise exception 'invalid reader key' using errcode = '28000';
  end if;
  return query
    select s.id, s.cue, s.reply, s.spoken, s.category, s.quality
      from private.dokyeong_dialogue_samples s
      where s.enabled and char_length(cue_term) between 2 and 20
        and replace(s.cue, ' ', '') ilike '%' || cue_term || '%'
      order by case when s.category = sample_category then 0 else 1 end, s.quality desc, s.id
      limit 250;
end;
$$;

revoke all on function public.dokyeong_register_sample_reader(text, text) from public;
revoke all on function public.dokyeong_list_samples(text, integer, text, text) from public;
revoke all on function public.dokyeong_save_sample(text, uuid, text, text, text, text, boolean) from public;
revoke all on function public.dokyeong_delete_sample(text, uuid) from public;
revoke all on function public.dokyeong_import_samples(text, jsonb) from public;
revoke all on function public.dokyeong_match_samples(text, text, text) from public;
revoke all on function public.dokyeong_register_sample_reader(text, text) from authenticated;
revoke all on function public.dokyeong_list_samples(text, integer, text, text) from authenticated;
revoke all on function public.dokyeong_save_sample(text, uuid, text, text, text, text, boolean) from authenticated;
revoke all on function public.dokyeong_delete_sample(text, uuid) from authenticated;
revoke all on function public.dokyeong_import_samples(text, jsonb) from authenticated;
revoke all on function public.dokyeong_match_samples(text, text, text) from authenticated;
grant execute on function public.dokyeong_register_sample_reader(text, text) to anon;
grant execute on function public.dokyeong_list_samples(text, integer, text, text) to anon;
grant execute on function public.dokyeong_save_sample(text, uuid, text, text, text, text, boolean) to anon;
grant execute on function public.dokyeong_delete_sample(text, uuid) to anon;
grant execute on function public.dokyeong_import_samples(text, jsonb) to anon;
grant execute on function public.dokyeong_match_samples(text, text, text) to anon;
