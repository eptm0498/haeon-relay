begin;

update public.cash_roulettes set name = '복권 긁기' where name = '캐시 룰렛';

insert into public.cash_roulettes(id, name, cost, active, sort_order, time_limit_minutes)
values (7, '경마 게임', 5000, true, 60, 0)
on conflict (id) do update set name = excluded.name, cost = excluded.cost, active = excluded.active;

insert into public.cash_roulette_items(id, roulette_id, label, result_type, cash_amount, weight, sort_order, time_limit_minutes)
values
  (7001, 7, '1번 날쌘돌이', 'nothing', 0, 20, 1, 0),
  (7002, 7, '2번 태풍', 'nothing', 0, 20, 2, 0),
  (7003, 7, '3번 번개', 'nothing', 0, 20, 3, 0),
  (7004, 7, '4번 불꽃', 'nothing', 0, 20, 4, 0),
  (7005, 7, '5번 질풍', 'nothing', 0, 20, 5, 0)
on conflict (id) do update set label = excluded.label, weight = excluded.weight, sort_order = excluded.sort_order;

create or replace function public.cash_horse_race(p_nickname text, p_pick integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.cash_users%rowtype;
  v_order integer[];
  v_winner integer;
  v_balance bigint;
  v_tx bigint;
begin
  if p_pick not between 1 and 5 then raise exception '말 번호를 다시 선택해줘.'; end if;
  if not exists (select 1 from public.cash_roulettes where name = '경마 게임' and active and cost = 5000) then
    raise exception '경마 게임을 사용할 수 없어.';
  end if;
  select * into v_user from public.cash_users where nickname = trim(p_nickname) for update;
  if not found then raise exception '사용자를 찾을 수 없어.'; end if;
  if v_user.cash_balance < 5000 then raise exception '캐시가 부족해.'; end if;

  select array_agg(n order by r) into v_order
  from (select n, random() as r from generate_series(1, 5) as n) shuffled;
  v_winner := v_order[1];
  v_balance := v_user.cash_balance - 5000 + case when p_pick = v_winner then 15000 else 0 end;

  update public.cash_users
  set cash_balance = v_balance, total_spent = total_spent + 5000, updated_at = now()
  where id = v_user.id;
  insert into public.cash_transactions(user_id, type, amount, item_name, note)
  values (v_user.id, 'roulette_spend', -5000, '경마 게임',
          jsonb_build_object('pick', p_pick, 'order', v_order)::text)
  returning id into v_tx;
  if p_pick = v_winner then
    insert into public.cash_transactions(user_id, type, amount, item_name, note)
    values (v_user.id, 'roulette_reward', 15000, '경마 게임',
            jsonb_build_object('pick', p_pick, 'winner', v_winner, 'race_transaction_id', v_tx)::text);
  end if;
  return jsonb_build_object('order', v_order, 'winner', v_winner, 'pick', p_pick,
                            'balance', v_balance, 'prize', case when p_pick = v_winner then 15000 else 0 end);
end $$;

revoke all on function public.cash_horse_race(text, integer) from public, anon, authenticated;
grant execute on function public.cash_horse_race(text, integer) to service_role;

commit;
