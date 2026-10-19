-- Tik izoliuotai vietinei / bandomajai DB po 001, 002, 003. Ne bendrai komandos DB.
-- Testai laikinai sukuria vartotojus, keičia talpyklą ir įterpia klaidą sukeliantį trigerį.
-- Visi testų duomenys ir objektai atšaukiami ROLLBACK. SQL Editor čia nenaudoti.
begin;

create temporary table buy_sell_test_results (name text not null);
grant select, insert on buy_sell_test_results to authenticated, anon, service_role;

create function pg_temp.assert_true(p_ok boolean, p_name text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'TEST_FAILED: %', p_name;
  end if;
  insert into pg_temp.buy_sell_test_results values (p_name);
end;
$$;

create function pg_temp.expect_error(p_sql text, p_state text, p_message text, p_name text)
returns void language plpgsql as $$
declare v_state text; v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    perform pg_temp.assert_true(
      v_state = p_state and (p_message is null or v_message = p_message),
      p_name || ' [' || v_state || ': ' || v_message || ']'
    );
    return;
  end;
  raise exception 'TEST_FAILED: klaida negauta: %', p_name;
end;
$$;

-- Fiksuoti UUID naudojami tik atšaukiamoje testų transakcijoje.
insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'buy-sell-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('b0000000-0000-4000-8000-000000000002', 'buy-sell-b@example.invalid', 'authenticated', 'authenticated', now(), now());

select pg_temp.assert_true(
  (select bool_and(cash_balance = 10000) from public.profiles
    where id in ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002')),
  'Registracija suteikia 10000 USD'
);

-- Kalendoriaus testai nepriklauso nuo testų vykdymo dienos.
select pg_temp.assert_true(trading_private.expected_trading_date('2026-10-18 16:00Z') = date '2026-10-16', 'Savaitgalis');
select pg_temp.assert_true(trading_private.expected_trading_date('2026-09-07 22:00Z') = date '2026-09-04', 'Pirmadienio šventė');
select pg_temp.assert_true(trading_private.expected_trading_date('2026-04-03 22:00Z') = date '2026-04-02', 'Didysis penktadienis');
select pg_temp.assert_true(trading_private.expected_trading_date('2026-10-19 21:59Z') = date '2026-10-16', 'Vasaros laikas prieš ribą');
select pg_temp.assert_true(trading_private.expected_trading_date('2026-10-19 22:00Z') = date '2026-10-19', 'Vasaros laikas po ribos');
select pg_temp.assert_true(trading_private.expected_trading_date('2026-11-02 22:59Z') = date '2026-10-30', 'Žiemos laikas prieš ribą');
select pg_temp.assert_true(trading_private.expected_trading_date('2026-11-02 23:00Z') = date '2026-11-02', 'Žiemos laikas po ribos');
select pg_temp.assert_true(trading_private.expected_trading_date('2026-11-27 20:00Z') = date '2026-11-27', 'Sutrumpinta diena');
select pg_temp.assert_true(trading_private.expected_trading_date('2028-01-01 18:00Z') = date '2027-12-31', 'Metų sandūra');
select pg_temp.assert_true(trading_private.expected_trading_date('2029-01-03 23:00Z') is null, 'Nežinomas kalendorius');

-- Šie integraciniai testai reikalauja šiuo metu kalendoriuje žinomos sesijos.
select pg_temp.assert_true(trading_private.expected_trading_date(clock_timestamp()) is not null,
  'Dabartinė data palaikoma kalendoriuje');
insert into public.av_quote_cache (symbol, price, trading_date, fetched_at)
values ('IBM', 100, trading_private.expected_trading_date(clock_timestamp()), clock_timestamp())
on conflict (symbol) do update set price = excluded.price,
  trading_date = excluded.trading_date, fetched_at = excluded.fetched_at;
delete from public.av_quote_cache where symbol = 'AAPL';

-- Privilegijos tikrinamos ir be RLS: tiesioginio pinigų keitimo nėra.
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'Vartotojas nekeičia balanso');
select pg_temp.assert_true(not has_table_privilege('service_role', 'public.profiles', 'UPDATE'), 'Serverio vaidmuo neapeina pinigų funkcijos');
select pg_temp.assert_true(not has_table_privilege('service_role', 'public.profiles', 'TRUNCATE'), 'Serveris neturi numatytosios TRUNCATE teisės');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.transactions', 'TRUNCATE'), 'Vartotojas netrina visos istorijos');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.buy_stock(uuid,text,integer)', 'EXECUTE'), 'Anon neturi BUY');
select pg_temp.assert_true(not has_function_privilege('service_role', 'public.buy_stock(uuid,text,integer)', 'EXECUTE'), 'Service role neapsimeta vartotoju');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'trading_private.execute_trade(uuid,text,integer,text)', 'EXECUTE'), 'Vidinė funkcija nevieša');

set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = '';
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;

select pg_temp.assert_true(
  (public.buy_stock('a0000000-0000-4000-8000-000000000001', ' ibm ', 2)->>'replayed')::boolean = false,
  'Pirmas BUY'
);
select pg_temp.assert_true((select cash_balance = 9800 from public.profiles), 'BUY balansas');
select pg_temp.assert_true((select quantity = 2 and average_cost = 100 from public.positions), 'BUY pozicija');
select pg_temp.assert_true(
  (select quote_at is null and quote_trading_date is not null and quote_source = 'Alpha Vantage'
    and quote_fetched_at is not null and quote_price = 100 and price = 100 and total_amount = 200
    from public.transactions where request_id = 'a0000000-0000-4000-8000-000000000001'),
  'Išsaugota DB kaina ir dienos metaduomenys'
);

reset role;
update public.av_quote_cache set price = 200 where symbol = 'IBM';
set local role authenticated;
select public.buy_stock('a0000000-0000-4000-8000-000000000002', 'IBM', 2);
select pg_temp.assert_true((select cash_balance = 9400 from public.profiles), 'Antras BUY balansas');
select pg_temp.assert_true((select quantity = 4 and average_cost = 150 from public.positions), 'Svertinė savikaina');
select public.sell_stock('a0000000-0000-4000-8000-000000000003', 'IBM', 1);
select pg_temp.assert_true((select cash_balance = 9600 from public.profiles), 'SELL balansas');
select pg_temp.assert_true((select quantity = 3 and average_cost = 150 from public.positions), 'Dalinis SELL savikainos nekeičia');

select pg_temp.assert_true(
  (public.buy_stock('a0000000-0000-4000-8000-000000000001', 'IBM', 2)->>'replayed')::boolean,
  'BUY pakartojimas'
);
select pg_temp.assert_true(
  (public.sell_stock('a0000000-0000-4000-8000-000000000003', 'IBM', 1)->>'replayed')::boolean,
  'SELL pakartojimas'
);
select pg_temp.assert_true((select count(*) = 3 from public.transactions), 'Pakartojimas nekuria sandorių');
select pg_temp.assert_true((select cash_balance = 9600 from public.profiles), 'Pakartojimas nekeičia balanso');

select pg_temp.expect_error($q$select public.buy_stock('a0000000-0000-4000-8000-000000000001','IBM',3)$q$,
  'P0001', 'REQUEST_ID_CONFLICT', 'Tas pats ID su kitu kiekiu');
select pg_temp.expect_error($q$select public.sell_stock('a0000000-0000-4000-8000-000000000001','IBM',2)$q$,
  'P0001', 'REQUEST_ID_CONFLICT', 'Tas pats ID su kitu veiksmu');
select pg_temp.expect_error($q$select public.buy_stock('a0000000-0000-4000-8000-000000000004','IBM',100000)$q$,
  'P0001', 'INSUFFICIENT_FUNDS', 'Nepakanka pinigų');
select pg_temp.expect_error($q$select public.sell_stock('a0000000-0000-4000-8000-000000000004','IBM',4)$q$,
  'P0001', 'INSUFFICIENT_SHARES', 'Nepakanka akcijų');
select pg_temp.expect_error($q$select public.buy_stock(null,'IBM',1)$q$, '22023', 'INVALID_REQUEST', 'ID būtinas');
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',0)$q$, '22023', 'INVALID_REQUEST', 'Nulinis kiekis');
select pg_temp.expect_error($q$select public.sell_stock(gen_random_uuid(),'IBM',-1)$q$, '22023', 'INVALID_REQUEST', 'Neigiamas kiekis');
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM&price=1',1)$q$, '22023', 'INVALID_REQUEST', 'Netinkamas simbolis');
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'AAPL',1)$q$, 'P0001', 'QUOTE_UNAVAILABLE', 'Kainos nėra');
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1,0.01::numeric)$q$, '42883', null, 'Kainos parametro nėra');
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1,'b0000000-0000-4000-8000-000000000002'::uuid)$q$,
  '42883', null, 'Svetimo vartotojo parametro nėra');
select pg_temp.expect_error($q$update public.profiles set cash_balance = 999999$q$, '42501', null, 'Tiesioginis balanso keitimas uždraustas');
select pg_temp.expect_error($q$delete from public.transactions$q$, '42501', null, 'Istorijos trynimas uždraustas');
select pg_temp.expect_error($q$update public.positions set quantity = 999$q$, '42501', null, 'Pozicijos keitimas uždraustas');
select pg_temp.expect_error($q$select public.av_finish_quote('IBM',gen_random_uuid(),1,current_date,false)$q$, '42501', null, 'Klientas nekeičia kainos');
select pg_temp.expect_error($q$select price from public.av_quote_cache$q$, '42501', null, 'Talpykla nėra tiesiogiai vieša');
select pg_temp.expect_error($q$select public.buy_stock('a0000000-0000-4000-8000-000000000001','AMD',2)$q$,
  'P0001', 'REQUEST_ID_CONFLICT', 'Tas pats ID su kitu simboliu');
select pg_temp.assert_true((select cash_balance = 9600 from public.profiles), 'Atmesti pavedimai nekeičia balanso');

reset role;
update public.av_quote_cache set fetched_at = clock_timestamp() - interval '2 days' where symbol = 'IBM';
set local role authenticated;
select pg_temp.assert_true(
  (public.buy_stock('a0000000-0000-4000-8000-000000000001','IBM',2)->>'replayed')::boolean,
  'Pakartojimas veikia net pasibaigus kainos galiojimui'
);
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1)$q$,
  'P0001', 'QUOTE_CACHE_EXPIRED', 'Pasibaigęs techninis TTL');
reset role;
update public.av_quote_cache set fetched_at = clock_timestamp(),
  trading_date = (clock_timestamp() at time zone 'UTC')::date - 7 where symbol = 'IBM';
set local role authenticated;
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1)$q$,
  'P0001', 'QUOTE_STALE', 'Savaitės senumo kaina nėra šviežia');
reset role;
update public.av_quote_cache set fetched_at = clock_timestamp() + interval '1 hour',
  trading_date = trading_private.expected_trading_date(clock_timestamp()) where symbol = 'IBM';
set local role authenticated;
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1)$q$,
  'P0001', 'QUOTE_CACHE_EXPIRED', 'Būsimas gavimo laikas');
reset role;
update public.av_quote_cache set fetched_at = clock_timestamp() where symbol = 'IBM';

-- Antro vartotojo duomenys izoliuoti; tas pats request_id galioja jo vardu atskirai.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;
select public.buy_stock('a0000000-0000-4000-8000-000000000001','IBM',1);
select pg_temp.assert_true((select count(*) = 1 and min(cash_balance) = 9800 from public.profiles), 'Mato tik savo profilį');
select pg_temp.assert_true((select count(*) = 1 from public.transactions), 'Mato tik savo sandorį');
select pg_temp.assert_true((select quantity = 1 from public.positions), 'Mato tik savo poziciją');
select pg_temp.assert_true(
  (select count(*) = 0 from public.profiles where id = 'b0000000-0000-4000-8000-000000000001'),
  'Svetimas profilis nematomas'
);
reset role;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;
select pg_temp.assert_true((select cash_balance = 9600 from public.profiles), 'Kito vartotojo sandoris nepakeitė balanso');

-- Tapatybė būtina net jei funkcijos EXECUTE teisė suteikta.
set local request.jwt.claims = '{"role":"authenticated"}';
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1)$q$, '28000', 'UNAUTHORIZED', 'JWT be sub');
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"service_role"}';
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1)$q$, '28000', 'UNAUTHORIZED', 'Netinkamas JWT vaidmuo');
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1)$q$, 'P0001', 'PROFILE_NOT_FOUND', 'Nėra profilio');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'IBM',1)$q$, '42501', null, 'Anon vykdymas atmestas');
reset role;
set local role service_role;
select pg_temp.expect_error($q$select public.sell_stock(gen_random_uuid(),'IBM',1)$q$, '42501', null, 'Serverio rakto vykdymas atmestas');
reset role;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Tyčia sukeliama klaida PASKUTINIAME žingsnyje, jau pakeitus balansą ir poziciją.
create function pg_temp.reject_trade_test()
returns trigger language plpgsql as $$
begin
  if new.request_id in (
    'a0000000-0000-4000-8000-000000000098'::uuid,
    'a0000000-0000-4000-8000-000000000099'::uuid
  ) then raise exception 'INJECTED_FAILURE'; end if;
  return new;
end;
$$;
create trigger buy_sell_test_failure before insert on public.transactions
  for each row execute function pg_temp.reject_trade_test();

set local role authenticated;
select pg_temp.expect_error($q$select public.buy_stock('a0000000-0000-4000-8000-000000000099','IBM',1)$q$,
  'P0001', 'INJECTED_FAILURE', 'BUY atšaukimas po finansinių pakeitimų');
select pg_temp.assert_true((select cash_balance = 9600 from public.profiles), 'BUY klaida atstatė balansą');
select pg_temp.assert_true((select quantity = 3 and average_cost = 150 from public.positions), 'BUY klaida atstatė poziciją');
select pg_temp.expect_error($q$select public.sell_stock('a0000000-0000-4000-8000-000000000098','IBM',3)$q$,
  'P0001', 'INJECTED_FAILURE', 'Pilno SELL atšaukimas po pozicijos pašalinimo');
select pg_temp.assert_true((select cash_balance = 9600 from public.profiles), 'SELL klaida atstatė balansą');
select pg_temp.assert_true((select quantity = 3 from public.positions), 'SELL klaida grąžino pašalintą poziciją');
select pg_temp.assert_true((select count(*) = 3 from public.transactions), 'Klaidų sandoriai neišsaugoti');

reset role;
drop trigger buy_sell_test_failure on public.transactions;
set local role authenticated;
select public.sell_stock('a0000000-0000-4000-8000-000000000098','IBM',3);
select pg_temp.assert_true((select count(*) = 0 from public.positions), 'Pilnas SELL pašalina poziciją');
select pg_temp.assert_true((select cash_balance = 10200 from public.profiles), 'Pilno SELL suma');
reset role;

insert into public.av_quote_cache (symbol, price, trading_date, fetched_at)
values ('AMD', 0.015, trading_private.expected_trading_date(clock_timestamp()), clock_timestamp())
on conflict (symbol) do update set price = excluded.price,
  trading_date = excluded.trading_date, fetched_at = excluded.fetched_at;
set local role authenticated;
select public.buy_stock('a0000000-0000-4000-8000-000000000005','AMD',1);
select pg_temp.assert_true((select cash_balance = 10199.98 from public.profiles), 'Vieneto kaina iki centų');
select pg_temp.assert_true((select average_cost = 0.02 from public.positions where symbol = 'AMD'), 'Savikaina pagal nuskaičiuotą sumą');
reset role;
update public.av_quote_cache set price = 0.000001 where symbol = 'AMD';
set local role authenticated;
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'AMD',1)$q$, '22003', 'INVALID_AMOUNT', 'Nulinė suapvalinta vieneto kaina atmetama');
reset role;

-- Perpildymo apsauga ir patikra, kad finansinės operacijos neliečia API kvotos.
update public.av_quote_cache set price = 1 where symbol = 'AMD';
update public.positions set quantity = 2147483647
  where user_id = 'b0000000-0000-4000-8000-000000000001' and symbol = 'AMD';
set local role authenticated;
select pg_temp.expect_error($q$select public.buy_stock(gen_random_uuid(),'AMD',1)$q$, '22003', 'POSITION_LIMIT', 'Pozicijos kiekio perpildymas');
reset role;
select pg_temp.assert_true((select count(*) = 0 from public.av_api_requests), 'Prekyba nesunaudojo API kvotos');

select count(*) as passed_assertions from pg_temp.buy_sell_test_results;
rollback;