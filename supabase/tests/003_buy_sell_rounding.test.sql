-- Tik izoliuotoje vietinėje / bandomojoje DB po 001–003. Ne bendroje Supabase DB.
-- Visos kotiruotės yra testiniai duomenys, ne tikros Alpha Vantage kainos.
-- Testo pabaigoje visi duomenys ir laikini objektai atšaukiami.
begin;

create temporary table rounding_test_results (name text not null);
create temporary table rounding_strategy_results (
  quote_price numeric, strategy integer, buy_total numeric, sell_total numeric,
  final_balance numeric
);
grant select, insert on rounding_test_results, rounding_strategy_results to authenticated;

create function pg_temp.round_assert(p_ok boolean, p_name text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'ROUNDING_TEST_FAILED: %', p_name; end if;
  insert into pg_temp.rounding_test_results values (p_name);
end;
$$;

create function pg_temp.round_expect(p_sql text, p_state text, p_message text, p_name text)
returns void language plpgsql as $$
declare v_state text; v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    perform pg_temp.round_assert(v_state = p_state and v_message = p_message,
      p_name || ' [' || v_state || ': ' || v_message || ']');
    return;
  end;
  raise exception 'ROUNDING_TEST_FAILED: klaida negauta: %', p_name;
end;
$$;

set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = '';

-- Keturi vienodo bendro kiekio variantai: didelis/didelis, didelis/skaidyti,
-- skaidyti/didelis, skaidyti/skaidyti. Tikrinami abu pinigų srautai ir visa istorija.
do $$
declare
  v_case record;
  v_strategy integer;
  v_i integer;
  v_uid uuid;
  v_last_sell uuid;
  v_sell_quantity integer;
  v_buy_total numeric;
  v_sell_total numeric;
  v_balance numeric;
  v_response jsonb;
begin
  for v_case in select * from (values
    (0.005000::numeric, 0.01::numeric),
    (0.009999, 0.01), (0.010000, 0.01),
    (0.014999, 0.01), (0.015000, 0.02), (0.015001, 0.02),
    (0.025000, 0.03), (0.333333, 0.33),
    (1.005000, 1.01), (100.005000, 100.01)
  ) as cases(raw_price, execution_price)
  loop
    for v_strategy in 0..3 loop
      v_uid := gen_random_uuid();
      insert into auth.users(id, email) values (v_uid, v_uid::text || '@example.invalid');
      insert into public.av_quote_cache(symbol, price, trading_date, fetched_at)
        values ('AMD', v_case.raw_price,
          trading_private.expected_trading_date(clock_timestamp()), clock_timestamp())
        on conflict (symbol) do update set price = excluded.price,
          trading_date = excluded.trading_date, fetched_at = excluded.fetched_at;
      perform set_config('request.jwt.claims',
        jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);

      if v_strategy < 2 then
        perform public.buy_stock(gen_random_uuid(), 'AMD', 6);
      else
        for v_i in 1..6 loop perform public.buy_stock(gen_random_uuid(), 'AMD', 1); end loop;
      end if;
      perform pg_temp.round_assert(
        (select cash_balance = 10000 - 6 * v_case.execution_price
          from public.profiles where id = v_uid),
        'BUY pinigai ' || v_case.raw_price || '/' || v_strategy
      );
      perform pg_temp.round_assert(
        (select quantity = 6 and average_cost = v_case.execution_price
          from public.positions where user_id = v_uid and symbol = 'AMD'),
        'BUY kiekis ir savikaina ' || v_case.raw_price || '/' || v_strategy
      );

      if v_strategy in (0, 2) then
        v_last_sell := gen_random_uuid();
        v_sell_quantity := 6;
        perform public.sell_stock(v_last_sell, 'AMD', v_sell_quantity);
      else
        v_sell_quantity := 1;
        for v_i in 1..6 loop
          v_last_sell := gen_random_uuid();
          perform public.sell_stock(v_last_sell, 'AMD', v_sell_quantity);
        end loop;
      end if;
      select sum(total_amount) filter (where side = 'buy'),
        sum(total_amount) filter (where side = 'sell')
        into v_buy_total, v_sell_total from public.transactions where user_id = v_uid;
      select cash_balance into v_balance from public.profiles where id = v_uid;
      perform pg_temp.round_assert(
        v_buy_total = 6 * v_case.execution_price and v_sell_total = v_buy_total,
        'Vienodos BUY ir SELL sumos ' || v_case.raw_price || '/' || v_strategy
      );
      perform pg_temp.round_assert(
        v_balance = 10000 and v_balance = 10000 - v_buy_total + v_sell_total,
        'Balansas sutampa su istorija ' || v_case.raw_price || '/' || v_strategy
      );
      perform pg_temp.round_assert(
        not exists (select 1 from public.positions where user_id = v_uid),
        'Pozicija uždaryta ' || v_case.raw_price || '/' || v_strategy
      );
      perform pg_temp.round_assert(
        (select bool_and(quote_price = v_case.raw_price
          and price = v_case.execution_price and total_amount = quantity::numeric * price)
          from public.transactions where user_id = v_uid),
        'API kaina, vykdymo kaina ir suma sutampa ' || v_case.raw_price || '/' || v_strategy
      );
      perform pg_temp.round_assert(
        (select count(*) = case v_strategy when 0 then 2 when 3 then 12 else 7 end
          from public.transactions where user_id = v_uid),
        'Visi sandoriai išsaugoti ' || v_case.raw_price || '/' || v_strategy
      );
      v_response := public.sell_stock(v_last_sell, 'AMD', v_sell_quantity);
      perform pg_temp.round_assert(
        (v_response->>'replayed')::boolean
          and (v_response->'transaction'->>'price')::numeric = v_case.execution_price
          and (select cash_balance = 10000 from public.profiles where id = v_uid),
        'Pakartojimas nesukuria centų ' || v_case.raw_price || '/' || v_strategy
      );
      insert into pg_temp.rounding_strategy_results
        values (v_case.raw_price, v_strategy, v_buy_total, v_sell_total, v_balance);
      perform set_config('role', 'none', true);
    end loop;
  end loop;
end;
$$;

select pg_temp.round_assert(
  not exists (
    select quote_price from pg_temp.rounding_strategy_results group by quote_price
    having count(*) <> 4 or count(distinct buy_total) <> 1
      or count(distinct sell_total) <> 1 or count(distinct final_balance) <> 1
  ), 'Vienas didelis ir visi skaidyti BUY/SELL variantai duoda tą patį rezultatą'
);

-- Ankstesnės spragos ciklas kartojamas 50 kartų su skirtingais request_id.
do $$
declare v_uid uuid := gen_random_uuid(); v_i integer;
begin
  insert into auth.users(id,email) values (v_uid, v_uid::text || '@example.invalid');
  update public.av_quote_cache set price = 0.015, fetched_at = clock_timestamp(),
    trading_date = trading_private.expected_trading_date(clock_timestamp()) where symbol = 'AMD';
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
  for v_i in 1..50 loop
    perform public.buy_stock(gen_random_uuid(),'AMD',2);
    perform public.sell_stock(gen_random_uuid(),'AMD',1);
    perform public.sell_stock(gen_random_uuid(),'AMD',1);
  end loop;
  perform pg_temp.round_assert((select cash_balance = 10000 from public.profiles where id = v_uid),
    '50 ankstesnio išnaudojimo ciklų nepadidina balanso');
  perform pg_temp.round_assert(
    (select count(*) = 150 and sum(case when side = 'buy' then -total_amount else total_amount end) = 0
      from public.transactions where user_id = v_uid),
    '150 sandorių pinigų srautas lygus nuliui'
  );
  perform pg_temp.round_assert(not exists (select 1 from public.positions where user_id = v_uid),
    'Po kartotinių ciklų nelieka akcijų');
  perform set_config('role','none',true);
end;
$$;

-- Mažesnė nei pusė cento vieneto kaina atmetama net esant dideliam kiekiui.
-- Taip pat atmetamas iki 10^12 USD suapvalintas įkainis (numeric(18,6) riba).
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_price numeric;
  v_quantity integer;
begin
  insert into auth.users(id,email) values (v_uid, v_uid::text || '@example.invalid');
  foreach v_price in array array[
    0.000001::numeric, 0.004999, 999999999999.995000, 999999999999.999999
  ] loop
    update public.av_quote_cache set price = v_price, fetched_at = clock_timestamp() where symbol = 'AMD';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
    perform set_config('role','authenticated',true);
    foreach v_quantity in array array[1, 2147483647] loop
      perform pg_temp.round_expect(
        format('select public.buy_stock(%L::uuid,%L,%s)',gen_random_uuid(),'AMD',v_quantity),
        '22003','INVALID_AMOUNT','Atmestas netinkamas BUY įkainis ' || v_price || '/' || v_quantity);
      perform pg_temp.round_expect(
        format('select public.sell_stock(%L::uuid,%L,%s)',gen_random_uuid(),'AMD',v_quantity),
        '22003','INVALID_AMOUNT','Atmestas netinkamas SELL įkainis ' || v_price || '/' || v_quantity);
    end loop;
    perform pg_temp.round_assert(
      (select cash_balance = 10000 from public.profiles where id = v_uid)
        and not exists(select 1 from public.transactions where user_id = v_uid)
        and not exists(select 1 from public.positions where user_id = v_uid),
      'Netinkamas įkainis nieko nepakeitė ' || v_price);
    perform set_config('role','none',true);
  end loop;
end;
$$;

-- Didžiausias sveikas kiekis vykdomas ir grąžinamas be centų praradimo.
do $$
declare v_uid uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values (v_uid, v_uid::text || '@example.invalid');
  update public.profiles set cash_balance = 100000000 where id = v_uid;
  update public.av_quote_cache set price = 0.005, fetched_at = clock_timestamp() where symbol = 'AMD';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
  perform public.buy_stock(gen_random_uuid(),'AMD',2147483647);
  perform pg_temp.round_assert(
    (select cash_balance = 78525163.53 from public.profiles where id = v_uid)
      and (select quantity = 2147483647 and average_cost = 0.01 from public.positions where user_id = v_uid),
    'Didžiausio kiekio pinigai ir pozicija tikslūs');
  perform public.sell_stock(gen_random_uuid(),'AMD',1);
  perform public.sell_stock(gen_random_uuid(),'AMD',2147483646);
  perform pg_temp.round_assert(
    (select cash_balance = 100000000 from public.profiles where id = v_uid)
      and not exists(select 1 from public.positions where user_id = v_uid),
    'Didžiausio kiekio skaidytas SELL tikslus');
  perform set_config('role','none',true);
end;
$$;

-- Pinigų tipų ribos: didžiausias centų balansas ir dar leistinas vykdymo įkainis.
do $$
declare v_uid uuid := gen_random_uuid(); v_request uuid;
begin
  insert into auth.users(id,email) values (v_uid, v_uid::text || '@example.invalid');
  update public.profiles set cash_balance = 9999999999999999.99 where id = v_uid;
  update public.av_quote_cache set price = 999999999999.994999,
    fetched_at = clock_timestamp() where symbol = 'AMD';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
  v_request := gen_random_uuid();
  perform public.buy_stock(v_request,'AMD',10000);
  perform pg_temp.round_assert(
    (select cash_balance = 99.99 from public.profiles where id = v_uid)
      and (select price = 999999999999.99 and total_amount = 9999999999999900.00
        and quote_price = 999999999999.994999 from public.transactions where request_id = v_request),
    'Didelė suma neperpildoma ir pradinė API kaina išlieka');
  perform public.sell_stock(gen_random_uuid(),'AMD',10000);
  perform pg_temp.round_assert((select cash_balance = 9999999999999999.99 from public.profiles where id = v_uid),
    'Didžiausias balansas tiksliai atkurtas');
  perform pg_temp.round_expect(
    format('select public.buy_stock(%L::uuid,%L,10001)',gen_random_uuid(),'AMD'),
    '22003','INVALID_AMOUNT','Bendros sumos perpildymas atmetamas');
  perform set_config('role','none',true);
  -- Tik administratoriaus testinė pradinė pozicija balanso perpildymui sukelti.
  insert into public.positions(user_id,symbol,quantity,average_cost) values (v_uid,'AMD',1,1);
  perform set_config('role','authenticated',true);
  perform pg_temp.round_expect(
    format('select public.sell_stock(%L::uuid,%L,1)',gen_random_uuid(),'AMD'),
    '22003','BALANCE_LIMIT','SELL balanso perpildymas atmetamas');
  perform pg_temp.round_assert(
    (select cash_balance = 9999999999999999.99 from public.profiles where id = v_uid)
      and (select quantity = 1 from public.positions where user_id = v_uid)
      and (select count(*) = 2 from public.transactions where user_id = v_uid),
    'Perpildymo klaidos nekeičia balanso, pozicijos ir istorijos');
  perform set_config('role','none',true);
end;
$$;

-- CHECK apribojimas neleidžia istorijoje nuslėpti vykdymo ir API kainų ryšio.
-- Naudojamos administratoriaus teisės tik tam, kad būtų patikrintas pats CHECK.
do $$
declare v_uid uuid := gen_random_uuid(); v_error text;
begin
  insert into auth.users(id,email) values (v_uid, v_uid::text || '@example.invalid');
  begin
    insert into public.transactions(
      user_id,request_id,symbol,side,quantity,price,quote_at,
      quote_trading_date,quote_fetched_at,quote_source,quote_price
    ) values (
      v_uid,gen_random_uuid(),'AMD','buy',1,0.03,null,
      trading_private.expected_trading_date(clock_timestamp()),clock_timestamp(),'Alpha Vantage',0.015
    );
  exception when check_violation then
    get stacked diagnostics v_error = constraint_name;
  end;
  perform pg_temp.round_assert(v_error = 'transactions_quote_metadata_valid',
    'Istorija negali turėti klaidingai normalizuotos kainos');
end;
$$;

select count(*) as rounding_assertions from pg_temp.rounding_test_results;
rollback;