begin;

create table public.cash_horse_settings (
  id integer primary key default 1 check (id = 1),
  probabilities integer[] not null,
  multipliers integer[] not null,
  updated_at timestamptz not null default now(),
  constraint valid_horse_settings check (
    array_length(probabilities, 1) = 5 and array_length(multipliers, 1) = 5
    and array_position(probabilities, null) is null and array_position(multipliers, null) is null
    and probabilities[1] between 0 and 100 and probabilities[2] between 0 and 100
    and probabilities[3] between 0 and 100 and probabilities[4] between 0 and 100
    and probabilities[5] between 0 and 100
    and probabilities[1] + probabilities[2] + probabilities[3] + probabilities[4] + probabilities[5] = 100
    and multipliers[1] between 1 and 100000 and multipliers[2] between 1 and 100000
    and multipliers[3] between 1 and 100000 and multipliers[4] between 1 and 100000
    and multipliers[5] between 1 and 100000
  )
);
alter table public.cash_horse_settings enable row level security;
revoke all on public.cash_horse_settings from public, anon, authenticated;
grant select, update on public.cash_horse_settings to service_role;
insert into public.cash_horse_settings (id, probabilities, multipliers)
values (1, array[30,25,20,15,10], array[307,368,460,613,920]);

create table public.cash_protected_users (
  user_id bigint primary key references public.cash_users(id) on delete restrict
);
alter table public.cash_protected_users enable row level security;
revoke all on public.cash_protected_users from public, anon, authenticated;
grant select on public.cash_protected_users to service_role;
insert into public.cash_protected_users (user_id)
select id from public.cash_users where nickname = '재경이';

create or replace function public.prevent_protected_cash_user_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.cash_protected_users where user_id = old.id) then
    raise exception '재경이 사용자는 사이트에서 삭제할 수 없어.';
  end if;
  return old;
end $$;
revoke all on function public.prevent_protected_cash_user_delete() from public, anon, authenticated;
create trigger protect_cash_user_before_delete
before delete on public.cash_users for each row
execute function public.prevent_protected_cash_user_delete();

create or replace function public.cash_horse_race_wager(p_nickname text, p_pick integer, p_wager bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.cash_users%rowtype;
  v_probabilities integer[];
  v_multipliers integer[];
  v_roll integer;
  v_winner integer;
  v_multiplier integer;
  v_order integer[];
  v_remaining integer[];
  v_prize bigint;
  v_balance bigint;
  v_tx bigint;
begin
  if p_pick not between 1 and 5 then raise exception '말 번호를 다시 선택해줘.'; end if;
  if p_wager is null or p_wager < 100 or p_wager > 1000000000000 or p_wager % 100 <> 0 then
    raise exception '판돈은 100캐시 단위로 입력해줘.';
  end if;
  if not exists (select 1 from public.cash_roulettes where name = '경마 게임' and active) then
    raise exception '경마 게임을 사용할 수 없어.';
  end if;

  select probabilities, multipliers into v_probabilities, v_multipliers
  from public.cash_horse_settings where id = 1 for share;
  if not found then raise exception '경마 설정을 찾을 수 없어.'; end if;

  select * into v_user from public.cash_users where nickname = trim(p_nickname) for update;
  if not found then raise exception '사용자를 찾을 수 없어.'; end if;
  if v_user.cash_balance < p_wager then raise exception '캐시가 부족해.'; end if;

  v_roll := floor(random() * 100)::integer + 1;
  v_winner := 5;
  for i in 1..5 loop
    v_roll := v_roll - v_probabilities[i];
    if v_roll <= 0 then v_winner := i; exit; end if;
  end loop;
  v_multiplier := v_multipliers[p_pick];
  v_prize := case when p_pick = v_winner then p_wager * v_multiplier / 100 else 0 end;
  select array_agg(n order by r) into v_remaining
  from (select n, random() as r from generate_series(1, 5) as n where n <> v_winner) shuffled;
  v_order := array_prepend(v_winner, v_remaining);
  v_balance := v_user.cash_balance - p_wager + v_prize;

  update public.cash_users
  set cash_balance = v_balance, total_spent = total_spent + p_wager, updated_at = now()
  where id = v_user.id;
  insert into public.cash_transactions(user_id, type, amount, item_name, note)
  values (v_user.id, 'roulette_spend', -p_wager, '경마 게임',
          jsonb_build_object('pick', p_pick, 'wager', p_wager, 'order', v_order,
                             'odds_hundredths', v_multiplier)::text)
  returning id into v_tx;
  if v_prize > 0 then
    insert into public.cash_transactions(user_id, type, amount, item_name, note)
    values (v_user.id, 'roulette_reward', v_prize, '경마 게임',
            jsonb_build_object('pick', p_pick, 'wager', p_wager, 'winner', v_winner,
                               'race_transaction_id', v_tx)::text);
  end if;

  return jsonb_build_object('order', v_order, 'winner', v_winner, 'pick', p_pick,
                            'wager', p_wager, 'balance', v_balance, 'prize', v_prize,
                            'probabilities', v_probabilities, 'multipliers', v_multipliers);
end $$;

revoke all on function public.cash_horse_race_wager(text, integer, bigint) from public, anon, authenticated;
grant execute on function public.cash_horse_race_wager(text, integer, bigint) to service_role;

commit;
