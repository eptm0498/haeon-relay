begin;

update public.cash_roulettes set cost = 0, active = true where name = '경마 게임';

update public.cash_roulette_items
set label = case sort_order
    when 1 then '1번 날쌘돌이'
    when 2 then '2번 태풍'
    when 3 then '3번 번개'
    when 4 then '4번 질풍'
    when 5 then '5번 흑마'
  end,
  weight = case sort_order
    when 1 then 30
    when 2 then 25
    when 3 then 20
    when 4 then 15
    when 5 then 10
  end
where roulette_id = (select id from public.cash_roulettes where name = '경마 게임')
  and sort_order between 1 and 5;

create or replace function public.cash_horse_race_wager(p_nickname text, p_pick integer, p_wager bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.cash_users%rowtype;
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

  select * into v_user from public.cash_users where nickname = trim(p_nickname) for update;
  if not found then raise exception '사용자를 찾을 수 없어.'; end if;
  if v_user.cash_balance < p_wager then raise exception '캐시가 부족해.'; end if;

  v_roll := floor(random() * 100)::integer + 1;
  v_winner := case
    when v_roll <= 30 then 1
    when v_roll <= 55 then 2
    when v_roll <= 75 then 3
    when v_roll <= 90 then 4
    else 5
  end;
  v_multiplier := (array[307, 368, 460, 613, 920])[p_pick];
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
                            'wager', p_wager, 'balance', v_balance, 'prize', v_prize);
end $$;

revoke all on function public.cash_horse_race_wager(text, integer, bigint) from public, anon, authenticated;
grant execute on function public.cash_horse_race_wager(text, integer, bigint) to service_role;

drop function if exists public.cash_horse_race(text, integer);

commit;
