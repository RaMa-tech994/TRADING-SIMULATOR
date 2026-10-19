-- BUY/SELL mokomajam simuliatoriui. Reikia jau pritaikytų 001 ir 002.
-- Vykdyti vieną kartą patikimo savininko (Supabase SQL Editor: postgres) teisėmis.
-- Šis failas tik parengiamas; automatiškai prie Supabase nesijungiama.
begin;

-- Nauji dienos kainų sandoriai nesukuria išgalvoto tikslaus kainos momento.
-- Seni įrašai išsaugo quote_at ir neturi būti užpildyti išgalvotomis datomis.
alter table public.transactions
  alter column quote_at drop not null,
  add column quote_trading_date date,
  add column quote_fetched_at timestamptz,
  add column quote_source text,
  add column quote_price numeric(18,6),
  add constraint transactions_quote_metadata_valid check (
    (quote_at is not null and quote_trading_date is null
      and quote_fetched_at is null and quote_source is null and quote_price is null)
    or
    (quote_at is null and quote_trading_date is not null
      and quote_fetched_at is not null and isfinite(quote_fetched_at)
      and quote_source is not null and quote_source = 'Alpha Vantage'
      and quote_price is not null and quote_price > 0 and quote_price < 'Infinity'::numeric
      and price = round(quote_price, 2) and price = round(price, 2))
  );

-- Schema nėra įtraukiama į Supabase Data API. Tiesioginio vykdymo teisių nėra.
create schema trading_private;
revoke all on schema trading_private from public, anon, authenticated, service_role;

-- Tas pats planinis 2026–2028 m. JAV akcijų rinkos kalendorius kaip freshness.mjs.
-- Šaltinis: NYSE / ICE 2026, 2027 ir 2028 metų švenčių ir ankstyvų uždarymų skelbimas.
-- Neplanuoti rinkos uždarymai neįtraukti. Už ribų prekyba saugiai atmetama.
create table trading_private.market_sessions (
  session_date date primary key,
  close_time time not null
);
insert into trading_private.market_sessions (session_date, close_time)
select d::date, time '16:00'
from generate_series(timestamp '2026-01-01', timestamp '2028-12-31', interval '1 day') as dates(d)
where extract(isodow from d) between 1 and 5
  and d::date <> all (array[
    date '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
    '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19',
    '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25'
  ]::date[]);
update trading_private.market_sessions set close_time = time '13:00'
where session_date in (
  date '2026-11-27', '2026-12-24', '2027-11-26', '2028-07-03', '2028-11-24'
);

create function trading_private.expected_trading_date(p_now timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when (p_now at time zone 'America/New_York')::date between date '2026-01-01' and date '2028-12-31'
    then (
      select max(s.session_date)
      from trading_private.market_sessions as s
      where s.session_date < (p_now at time zone 'America/New_York')::date
        or (s.session_date = (p_now at time zone 'America/New_York')::date
          and (p_now at time zone 'America/New_York')::time >= s.close_time + interval '2 hours')
    )
    else null::date
  end;
$$;

-- Bendras vykdymas pasiekiamas tik per žemiau esančius du saugius RPC.
-- Visi pinigai skaičiuojami numeric tipais; išorinių HTTP kvietimų čia nėra.
create function trading_private.execute_trade(
  p_request_id uuid, p_symbol text, p_quantity integer, p_side text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_symbol text := upper(btrim(p_symbol));
  v_profile public.profiles%rowtype;
  v_position public.positions%rowtype;
  v_quote public.av_quote_cache%rowtype;
  v_transaction public.transactions%rowtype;
  v_now timestamptz;
  v_expected date;
  v_total numeric;
  v_execution_price numeric;
  v_new_quantity bigint;
  v_average_cost numeric;
begin
  -- RLS savininko funkcijose nepakeičia aiškaus vartotojo tikrinimo.
  -- auth.uid()/auth.role() nustatomi iš Supabase patikrinto vartotojo JWT.
  if v_user_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '28000', message = 'UNAUTHORIZED';
  end if;
  if p_request_id is null or p_quantity is null or p_quantity <= 0
    or p_side is null or p_side not in ('buy', 'sell')
    or v_symbol is null or v_symbol not in (
      'AAPL','MSFT','AMZN','GOOGL','META','NVDA','TSLA','IBM','NFLX','AMD'
    ) then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST';
  end if;

  -- Visos vartotojo operacijos serializuojamos net skirtingiems simboliams.
  -- Tvarka: profilis -> sandorio patikra -> kainos SHARE -> pozicija.
  select * into v_profile from public.profiles
    where id = v_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  -- Pakartojimas grąžina išsaugotą sandorį net kainai vėliau pasenus.
  select * into v_transaction from public.transactions
    where user_id = v_user_id and request_id = p_request_id;
  if found then
    if v_transaction.symbol <> v_symbol or v_transaction.side <> p_side
      or v_transaction.quantity <> p_quantity then
      raise exception using errcode = 'P0001', message = 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object('transaction', to_jsonb(v_transaction), 'replayed', true);
  end if;

  -- Kaina niekada nepriimama iš kliento. SHARE neleidžia jos pakeisti iki COMMIT.
  -- 002 funkcijos užrakina av_api_control -> kainą; mes av_api_control neliečiame.
  select * into v_quote from public.av_quote_cache
    where symbol = v_symbol for share;
  if not found or v_quote.price is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_UNAVAILABLE';
  end if;
  -- Laikas vertinamas po visų galimų laukimų ties profiliu ir kaina.
  v_now := clock_timestamp();
  if v_quote.fetched_at is null or not isfinite(v_quote.fetched_at)
    or v_quote.fetched_at > v_now
    or v_quote.fetched_at <= v_now - interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'QUOTE_CACHE_EXPIRED';
  end if;
  v_expected := trading_private.expected_trading_date(v_now);
  if v_expected is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_UNVERIFIED';
  end if;
  if v_quote.trading_date is null or v_quote.trading_date < v_expected
    or v_quote.trading_date > (v_now at time zone 'America/New_York')::date
    or v_quote.trading_date < (v_now at time zone 'UTC')::date - 7
    or not exists (
      select 1 from trading_private.market_sessions where session_date = v_quote.trading_date
    ) then
    raise exception using errcode = 'P0001', message = 'QUOTE_STALE';
  end if;
  if v_quote.price <= 0 or v_quote.price >= 'Infinity'::numeric then
    raise exception using errcode = 'P0001', message = 'INVALID_QUOTE';
  end if;

  -- Viena nuosekli centų politika: pirma apvalinama VIENETO kaina.
  -- Tas pats vykdymo įkainis BUY ir SELL; sumos neapvalinamos per pavedimą.
  -- q * centų_kaina = visų skaidytų kiekių suma * centų_kaina.
  -- Pradinė API kaina lieka quote_price, price saugo realų vykdymo įkainį.
  v_execution_price := round(v_quote.price, 2);
  if v_execution_price <= 0 or v_execution_price >= 1000000000000 then
    raise exception using errcode = '22003', message = 'INVALID_AMOUNT';
  end if;
  v_total := p_quantity::numeric * v_execution_price;
  if v_total <= 0 or v_total >= 10000000000000000 then
    raise exception using errcode = '22003', message = 'INVALID_AMOUNT';
  end if;
  select * into v_position from public.positions
    where user_id = v_user_id and symbol = v_symbol for update;

  if p_side = 'buy' then
    if v_profile.cash_balance < v_total then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_FUNDS';
    end if;
    v_new_quantity := coalesce(v_position.quantity, 0)::bigint + p_quantity::bigint;
    if v_new_quantity > 2147483647 then
      raise exception using errcode = '22003', message = 'POSITION_LIMIT';
    end if;
    -- Savikainai naudojama realiai nuskaičiuota suma pagal centų vieneto įkainį.
    v_average_cost := round(
      (coalesce(v_position.quantity::numeric * v_position.average_cost, 0) + v_total)
      / v_new_quantity, 6
    );
    if v_average_cost <= 0 or v_average_cost >= 1000000000000 then
      raise exception using errcode = '22003', message = 'INVALID_AVERAGE_COST';
    end if;
    update public.profiles set cash_balance = cash_balance - v_total where id = v_user_id;
    insert into public.positions (user_id, symbol, quantity, average_cost, updated_at)
      values (v_user_id, v_symbol, v_new_quantity::integer, v_average_cost, v_now)
      on conflict (user_id, symbol) do update
        set quantity = excluded.quantity, average_cost = excluded.average_cost,
            updated_at = excluded.updated_at;
  else
    if v_position.id is null or v_position.quantity < p_quantity then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_SHARES';
    end if;
    if v_profile.cash_balance + v_total >= 10000000000000000 then
      raise exception using errcode = '22003', message = 'BALANCE_LIMIT';
    end if;
    update public.profiles set cash_balance = cash_balance + v_total where id = v_user_id;
    if v_position.quantity = p_quantity then
      delete from public.positions where id = v_position.id and user_id = v_user_id;
    else
      update public.positions set quantity = quantity - p_quantity, updated_at = v_now
        where id = v_position.id and user_id = v_user_id;
    end if;
  end if;

  -- Klaida net šiame paskutiniame žingsnyje atšaukia ir balansą, ir poziciją.
  insert into public.transactions (
    user_id, request_id, symbol, side, quantity, price, quote_at, executed_at,
    quote_trading_date, quote_fetched_at, quote_source, quote_price
  ) values (
    v_user_id, p_request_id, v_symbol, p_side, p_quantity, v_execution_price, null, v_now,
    v_quote.trading_date, v_quote.fetched_at, 'Alpha Vantage', v_quote.price
  ) returning * into v_transaction;
  return jsonb_build_object('transaction', to_jsonb(v_transaction), 'replayed', false);
end;
$$;

-- Viešoje sąsajoje nėra nei kainos, nei user_id parametro.
create function public.buy_stock(p_request_id uuid, p_symbol text, p_quantity integer)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select trading_private.execute_trade(p_request_id, p_symbol, p_quantity, 'buy');
$$;

create function public.sell_stock(p_request_id uuid, p_symbol text, p_quantity integer)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select trading_private.execute_trade(p_request_id, p_symbol, p_quantity, 'sell');
$$;

revoke all on all tables in schema trading_private from public, anon, authenticated, service_role;
revoke all on all functions in schema trading_private from public, anon, authenticated, service_role;
revoke all on function public.buy_stock(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.sell_stock(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.buy_stock(uuid, text, integer) to authenticated;
grant execute on function public.sell_stock(uuid, text, integer) to authenticated;

-- Ankstesnės RLS SELECT politikos nekeičiamos. Jokių vartotojo rašymo teisių.
-- service_role taip pat neberašo finansinių lentelių tiesiogiai.
-- Registracijos trigeris ir RPC veikia patikimo savininko teisėmis.
revoke all privileges on table public.profiles, public.positions, public.transactions
  from service_role;
grant select on table public.profiles, public.positions, public.transactions to service_role;

comment on column public.transactions.price is
  'Vienos akcijos vykdymo kaina USD: serverio API kaina suapvalinta iki centų prieš dauginant iš kiekio.';
comment on column public.transactions.quote_price is
  'Pradinė neapvalinta Alpha Vantage kaina; seniems įrašams nežinoma ir paliekama NULL.';

comment on function public.buy_stock(uuid, text, integer) is
  'Virtualus pirkimas tik JWT vartotojui; kaina imama iš serverio dienos kainų talpyklos.';
comment on function public.sell_stock(uuid, text, integer) is
  'Virtualus pardavimas tik JWT vartotojui; tas pats request_id neįvykdomas antrą kartą.';

commit;