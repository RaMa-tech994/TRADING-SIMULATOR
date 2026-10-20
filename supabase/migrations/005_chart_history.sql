-- Grafikų #16, #17 ir #18 duomenų pagrindas. Reikia pritaikytų 001–004.
-- Vienkartinė migracija, vykdoma patikimo savininko teisėmis tik po peržiūros.
-- Šio failo parengimas nieko nevykdo bendroje Supabase duomenų bazėje.
-- BUY/SELL, get-quote ir portfolio funkcijos nekeičiamos.
begin;

-- #16: vieno simbolio paskutinių iki 100 prekybos dienų tikros API kainos.
-- points formatas: [{"date":"YYYY-MM-DD","close":"123.450000"}, ...].
-- Saugomos nepakoreguotos TIME_SERIES_DAILY uždarymo kainos, ne intraday duomenys.
-- Tai bendra rinkos talpykla be vartotojų duomenų. Naršyklė jos tiesiogiai nepasiekia.
create table public.av_price_history_cache (
  symbol text primary key check (
    symbol in ('AAPL','MSFT','AMZN','GOOGL','META','NVDA','TSLA','IBM','NFLX','AMD')
  ),
  points jsonb,
  latest_trading_date date,
  fetched_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  check (
    (points is null and latest_trading_date is null and fetched_at is null)
    or (points is not null and jsonb_typeof(points) = 'array'
      and latest_trading_date is not null and isfinite(latest_trading_date)
      and fetched_at is not null and isfinite(fetched_at))
  ),
  check ((lease is null) = (lease_until is null)),
  check (lease_until is null or isfinite(lease_until))
);
alter table public.av_price_history_cache enable row level security;
revoke all on table public.av_price_history_cache from public, anon, authenticated, service_role;

-- Rezervuojant visada užrakinama TA PATI 002 av_api_control eilutė.
-- GLOBAL_QUOTE ir TIME_SERIES_DAILY dalijasi tais pačiais 25 bandymais / 24 val.,
-- 15 sekundžių tarpu, pauze po tiekėjo limito ir av_api_requests žurnalu.
-- Ši funkcija nekeičia 002 funkcijų ir pati nekviečia jokio HTTP API.
create function public.av_reserve_price_history(p_symbol text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_control public.av_api_control%rowtype;
  v_cache public.av_price_history_cache%rowtype;
  v_history jsonb := null;
  v_lease uuid;
begin
  if p_symbol is null or p_symbol not in (
    'AAPL','MSFT','AMZN','GOOGL','META','NVDA','TSLA','IBM','NFLX','AMD'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_SYMBOL';
  end if;
  select * into strict v_control from public.av_api_control where id = 1 for update;
  v_now := clock_timestamp();
  insert into public.av_price_history_cache(symbol) values (p_symbol)
    on conflict (symbol) do nothing;
  select * into strict v_cache from public.av_price_history_cache
    where symbol = p_symbol for update;
  if v_cache.points is not null then
    v_history := jsonb_build_object(
      'symbol', p_symbol, 'points', v_cache.points,
      'latest_trading_date', v_cache.latest_trading_date, 'fetched_at', v_cache.fetched_at,
      'source', 'Alpha Vantage', 'data_type', 'daily_close', 'is_realtime', false,
      'cache_fresh', v_cache.fetched_at <= v_now
        and v_cache.fetched_at > v_now - interval '24 hours'
    );
    -- Techninis galiojimas nepatvirtina prekybos datos aktualumo.
    -- Būsimas endpointas privalės pateikti latest_trading_date ir senumo perspėjimą.
    if v_cache.fetched_at <= v_now and v_cache.fetched_at > v_now - interval '24 hours'
      and v_cache.latest_trading_date <= (v_now at time zone 'UTC')::date
      and v_cache.latest_trading_date >= (v_now at time zone 'UTC')::date - 7 then
      return jsonb_build_object('action', 'cache', 'history', v_history);
    end if;
  end if;
  if v_cache.lease_until > v_now then
    return jsonb_build_object('action', 'busy', 'history', v_history);
  end if;
  delete from public.av_api_requests where requested_at <= v_now - interval '24 hours';
  if v_control.paused_until > v_now
    or (select count(*) from public.av_api_requests) >= 25 then
    return jsonb_build_object('action', 'quota', 'history', v_history);
  end if;
  if v_control.next_request_at > v_now then
    return jsonb_build_object('action', 'throttled', 'history', v_history);
  end if;
  v_lease := gen_random_uuid();
  insert into public.av_api_requests(requested_at) values (v_now);
  update public.av_api_control set next_request_at = v_now + interval '15 seconds' where id = 1;
  update public.av_price_history_cache
    set lease = v_lease, lease_until = v_now + interval '60 seconds' where symbol = p_symbol;
  return jsonb_build_object('action', 'fetch', 'lease', v_lease, 'history', v_history);
end;
$$;

-- Tik patikimas serveris pateikia patikrintą tikro API atsakymo seriją.
-- NULL points atlaisvina rezervaciją po klaidos; sunaudota kvota negrąžinama.
-- Nauja istorija atomiškai pakeičia tik šio simbolio kompaktišką talpyklą.
create function public.av_finish_price_history(
  p_symbol text, p_lease uuid, p_points jsonb, p_rate_limited boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_cache public.av_price_history_cache%rowtype;
  v_point jsonb;
  v_date date;
  v_previous date := null;
  v_close numeric;
  v_points jsonb := '[]'::jsonb;
begin
  perform 1 from public.av_api_control where id = 1 for update;
  v_now := clock_timestamp();
  select * into v_cache from public.av_price_history_cache where symbol = p_symbol for update;
  if not found or p_lease is null or v_cache.lease is distinct from p_lease
    or v_cache.lease_until <= v_now or p_rate_limited is null then
    raise exception using errcode = '22023', message = 'INVALID_HISTORY_LEASE';
  end if;
  if p_rate_limited then
    -- Prie limito pranešimo kainų duomenys nepriimami.
    if p_points is not null then
      raise exception using errcode = '22023', message = 'INVALID_HISTORY';
    end if;
    update public.av_api_control
      set paused_until = greatest(paused_until, v_now + interval '1 hour') where id = 1;
  end if;
  if p_points is not null then
    if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) not between 1 and 100 then
      raise exception using errcode = '22023', message = 'INVALID_HISTORY';
    end if;
    for v_point in select value from jsonb_array_elements(p_points) loop
      if jsonb_typeof(v_point) <> 'object'
        or (select count(*) from jsonb_object_keys(v_point)) <> 2
        or jsonb_typeof(v_point->'date') is distinct from 'string'
        or jsonb_typeof(v_point->'close') is distinct from 'string'
        or (v_point->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or (v_point->>'close') !~ '^[0-9]+(\.[0-9]{1,6})?$' then
        raise exception using errcode = '22023', message = 'INVALID_HISTORY';
      end if;
      -- Netikra kalendorinė data atmetama PostgreSQL date konvertavimo metu.
      v_date := (v_point->>'date')::date;
      v_close := (v_point->>'close')::numeric;
      if not isfinite(v_date) or to_char(v_date, 'YYYY-MM-DD') <> v_point->>'date'
        or v_date > (v_now at time zone 'UTC')::date
        or (v_previous is not null and v_date <= v_previous)
        or v_close <= 0 or v_close >= 1000000000000 then
        raise exception using errcode = '22023', message = 'INVALID_HISTORY';
      end if;
      v_previous := v_date;
      v_points := v_points || jsonb_build_array(jsonb_build_object(
        'date', to_char(v_date, 'YYYY-MM-DD'), 'close', v_close::text
      ));
    end loop;
    if v_previous < (v_now at time zone 'UTC')::date - 7
      or (v_cache.latest_trading_date is not null and v_previous < v_cache.latest_trading_date) then
      raise exception using errcode = '22023', message = 'HISTORY_DATE_REGRESSION';
    end if;
    update public.av_price_history_cache
      set points = v_points, latest_trading_date = v_previous, fetched_at = v_now
      where symbol = p_symbol;
  end if;
  update public.av_price_history_cache set lease = null, lease_until = null where symbol = p_symbol;
end;
$$;

revoke all on function public.av_reserve_price_history(text) from public, anon, authenticated, service_role;
revoke all on function public.av_finish_price_history(text, uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.av_reserve_price_history(text) to service_role;
grant execute on function public.av_finish_price_history(text, uuid, jsonb, boolean) to service_role;

-- #17 ir #18: naudojama ESAMA snapshots lentelė, be istorinių duomenų užpildymo.
-- Senų eilučių request_id / valuation_details paliekami NULL; reikšmės neišgalvojamos.
alter table public.snapshots
  add column request_id uuid,
  add column valuation_details jsonb,
  add constraint snapshots_user_request_unique unique(user_id, request_id),
  add constraint snapshots_valuation_details_object check (
    valuation_details is null or jsonb_typeof(valuation_details) = 'object'
  );

-- Vartotojui ir toliau nesuteikiamos tiesioginės INSERT/UPDATE/DELETE teisės.
-- Serverio tiesioginis rašymas taip pat uždaromas; įrašoma tik per saugų RPC.
revoke all on table public.snapshots from service_role;
grant select on table public.snapshots to service_role;

-- Naujas taškas tik pagal dabartinius DB duomenis ir patvirtintą kainų talpyklą.
-- Klientas pateikia TIK request_id: nei sumų, nei user_id, nei datos nepriimame.
-- Šis RPC nevykdo sandorių, nekeičia profilio / pozicijų ir nenaudoja API kvotos.
create function public.capture_portfolio_snapshot(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_snapshot public.snapshots%rowtype;
  v_now timestamptz;
  v_expected date;
  v_count bigint;
  v_valid_count bigint;
  v_holdings numeric;
  v_prices jsonb;
  v_replayed boolean := false;
begin
  if v_user_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '28000', message = 'UNAUTHORIZED';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST';
  end if;
  -- Ta pati profilio užrakinimo tvarka kaip BUY/SELL; vykdymo principai nekeičiami.
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;
  select * into v_snapshot from public.snapshots
    where user_id = v_user_id and request_id = p_request_id;
  if found then
    v_replayed := true;
  else
    v_now := clock_timestamp();
    -- Vienam vartotojui ne daugiau vieno naujo taško per minutę.
    -- To paties ID pakartojimas grąžinamas prieš šią patikrą.
    if exists (select 1 from public.snapshots
      where user_id = v_user_id and captured_at > v_now - interval '1 minute') then
      raise exception using errcode = 'P0001', message = 'SNAPSHOT_TOO_SOON';
    end if;
    -- Užrakinamos visos naudojamos kainos stabilia simbolių tvarka.
    perform q.symbol from public.av_quote_cache as q
      join public.positions as pos on pos.symbol = q.symbol
      where pos.user_id = v_user_id order by q.symbol for share of q;
    -- Aktualumas vertinamas po laukimo ties visomis kainomis.
    v_now := clock_timestamp();
    v_expected := trading_private.expected_trading_date(v_now);
    select count(*), count(*) filter (where
        q.price > 0 and q.price < 'Infinity'::numeric
        and q.fetched_at is not null and isfinite(q.fetched_at)
        and q.fetched_at <= v_now and q.fetched_at > v_now - interval '24 hours'
        and q.trading_date >= v_expected
        and q.trading_date <= (v_now at time zone 'America/New_York')::date
        and q.trading_date >= (v_now at time zone 'UTC')::date - 7
        and exists (select 1 from trading_private.market_sessions as s where s.session_date = q.trading_date)
      ), coalesce(sum(round(pos.quantity::numeric * q.price, 2)), 0),
      coalesce(jsonb_object_agg(pos.symbol, jsonb_build_object(
        'quantity', pos.quantity, 'price', q.price::text,
        'trading_date', q.trading_date, 'fetched_at', q.fetched_at
      )), '{}'::jsonb)
      into v_count, v_valid_count, v_holdings, v_prices
      from public.positions as pos left join public.av_quote_cache as q on q.symbol = pos.symbol
      where pos.user_id = v_user_id;
    if v_count > 0 and v_expected is null then
      raise exception using errcode = 'P0001', message = 'QUOTE_UNVERIFIED';
    end if;
    if v_count <> v_valid_count then
      raise exception using errcode = 'P0001', message = 'INCOMPLETE_VALUATION';
    end if;
    if v_holdings < 0 or v_holdings >= 10000000000000000 then
      raise exception using errcode = '22003', message = 'VALUATION_LIMIT';
    end if;
    insert into public.snapshots(user_id, captured_at, cash_balance, holdings_value, request_id, valuation_details)
      values (v_user_id, v_now, v_profile.cash_balance, v_holdings, p_request_id,
        jsonb_build_object('source', 'Alpha Vantage', 'data_type', 'end_of_day',
          'is_realtime', false, 'prices', v_prices))
      returning * into v_snapshot;
  end if;
  return jsonb_build_object('replayed', v_replayed, 'snapshot', jsonb_build_object(
    'id', v_snapshot.id, 'request_id', v_snapshot.request_id, 'captured_at', v_snapshot.captured_at,
    'cash_balance', v_snapshot.cash_balance::text, 'holdings_value', v_snapshot.holdings_value::text,
    'portfolio_value', (v_snapshot.cash_balance + v_snapshot.holdings_value)::text,
    'total_profit_loss', (v_snapshot.cash_balance + v_snapshot.holdings_value - 10000.00)::text,
    'valuation_details', v_snapshot.valuation_details
  ));
end;
$$;
revoke all on function public.capture_portfolio_snapshot(uuid) from public, anon, authenticated, service_role;
grant execute on function public.capture_portfolio_snapshot(uuid) to authenticated;

-- Viena skaitymo sąsaja abiem vartotojo istorijos grafikams.
-- P/L = bendra portfelio vertė - pradiniai 10000 USD: realizuotas + nerealizuotas.
-- Prielaida: nėra papildomų įnašų, išėmimų ar administracinio balanso atstatymo.
-- Senos dienos neperskaičiuojamos iš dabartinių pozicijų; rodomi tik išsaugoti taškai.
create function public.get_portfolio_history(
  p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '28000', message = 'UNAUTHORIZED';
  end if;
  if p_limit is null or p_limit not between 1 and 500
    or (p_from is not null and not isfinite(p_from))
    or (p_to is not null and not isfinite(p_to))
    or (p_from is not null and p_to is not null and p_from > p_to) then
    raise exception using errcode = '22023', message = 'INVALID_HISTORY_RANGE';
  end if;
  return (
    with recent as materialized (
      select * from public.snapshots
      where user_id = (select auth.uid())
        and (p_from is null or captured_at >= p_from)
        and (p_to is null or captured_at <= p_to)
      order by captured_at desc, id desc limit p_limit + 1
    ), page as (
      select * from recent order by captured_at desc, id desc limit p_limit
    )
    select jsonb_build_object(
      'currency', 'USD', 'initial_balance', '10000.00',
      'profit_loss_type', 'total_since_initial_balance',
      'has_more', (select count(*) > p_limit from recent),
      'points', coalesce((select jsonb_agg(jsonb_build_object(
        'captured_at', captured_at, 'cash_balance', cash_balance::text,
        'holdings_value', holdings_value::text,
        'portfolio_value', (cash_balance + holdings_value)::text,
        'total_profit_loss', (cash_balance + holdings_value - 10000.00)::text,
        'valuation_details', valuation_details
      ) order by captured_at, id) from page), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_portfolio_history(timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_portfolio_history(timestamptz, timestamptz, integer) to authenticated;

comment on table public.av_price_history_cache is
  'Tikra kompaktiška API dienos kainų istorija; bendra 002 kvota; prieiga tik per serverio RPC.';
comment on function public.capture_portfolio_snapshot(uuid) is
  'Tik savo tikro dabartinio portfelio pilnas vertinimas iš serverio talpyklos; jokių sandorių ar istorijos išgalvojimo.';
comment on function public.get_portfolio_history(timestamptz, timestamptz, integer) is
  'Savo tikrų stebėjimų istorija #17 ir bendras P/L #18 nuo pradinio balanso, taikant RLS.';
commit;
