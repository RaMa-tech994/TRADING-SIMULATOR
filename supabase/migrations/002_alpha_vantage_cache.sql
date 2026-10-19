-- Savarankiška rinkos duomenų migracija; nepriklauso nuo vartotojų lentelių.
-- Tik išsaugoti projektui: ši migracija automatiškai nevykdoma.
begin;

create table public.av_quote_cache (
  symbol text primary key check (
    symbol in ('AAPL','MSFT','AMZN','GOOGL','META','NVDA','TSLA','IBM','NFLX','AMD')
  ),
  price numeric(18,6),
  trading_date date,
  fetched_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  check (
    (price is null and trading_date is null and fetched_at is null)
    or (price is not null and price > 0 and price < 'Infinity'::numeric
        and trading_date is not null and fetched_at is not null)
  ),
  check ((lease is null) = (lease_until is null))
);

-- Viena eilutė serializuoja išorinių API užklausų rezervavimą visame projekte.
create table public.av_api_control (
  id integer primary key check (id = 1),
  next_request_at timestamptz not null default '-infinity',
  paused_until timestamptz not null default '-infinity'
);
insert into public.av_api_control (id) values (1);

-- Skaičiuojami ir nepavykę išoriniai kvietimai: jie taip pat gali naudoti kvotą.
create table public.av_api_requests (
  id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null
);
create index av_api_requests_time_idx on public.av_api_requests (requested_at);

alter table public.av_quote_cache enable row level security;
alter table public.av_api_control enable row level security;
alter table public.av_api_requests enable row level security;

-- Naršyklė negali skaityti ar keisti vidinės talpyklos ir rezervacijų.
-- service_role kviečia tik toliau aprašytas savininko teisėmis veikiančias funkcijas.
revoke all privileges on table
  public.av_quote_cache, public.av_api_control, public.av_api_requests
from public, anon, authenticated, service_role;

create function public.av_reserve_quote(p_symbol text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_control public.av_api_control%rowtype;
  v_cache public.av_quote_cache%rowtype;
  v_quote jsonb := null;
  v_lease uuid;
begin
  if p_symbol is null or p_symbol not in (
    'AAPL','MSFT','AMZN','GOOGL','META','NVDA','TSLA','IBM','NFLX','AMD'
  ) then
    raise exception 'Nepalaikomas akcijos simbolis';
  end if;

  select * into strict v_control from public.av_api_control where id = 1 for update;
  -- Laikas imamas po užrakto gavimo, o ne transakcijos pradžioje.
  v_now := clock_timestamp();
  insert into public.av_quote_cache (symbol) values (p_symbol)
    on conflict (symbol) do nothing;
  select * into strict v_cache from public.av_quote_cache where symbol = p_symbol;

  if v_cache.price is not null then
    v_quote := jsonb_build_object(
      'symbol', v_cache.symbol, 'price', v_cache.price::text,
      'trading_date', v_cache.trading_date, 'fetched_at', v_cache.fetched_at
    );
    if v_cache.fetched_at > v_now - interval '24 hours'
       and v_cache.trading_date >= (v_now at time zone 'UTC')::date - 7 then
      return jsonb_build_object('action', 'cache', 'quote', v_quote);
    end if;
  end if;

  if v_cache.lease_until > v_now then
    return jsonb_build_object('action', 'busy', 'quote', v_quote);
  end if;

  delete from public.av_api_requests where requested_at <= v_now - interval '24 hours';
  if v_control.paused_until > v_now
     or (select count(*) from public.av_api_requests) >= 25 then
    return jsonb_build_object('action', 'quota', 'quote', v_quote);
  end if;
  -- Papildomas konservatyvus tarpas tarp išorinių kvietimų.
  if v_control.next_request_at > v_now then
    return jsonb_build_object('action', 'throttled', 'quote', v_quote);
  end if;

  v_lease := gen_random_uuid();
  insert into public.av_api_requests (requested_at) values (v_now);
  update public.av_api_control set next_request_at = v_now + interval '15 seconds' where id = 1;
  update public.av_quote_cache
    set lease = v_lease, lease_until = v_now + interval '60 seconds'
    where symbol = p_symbol;
  return jsonb_build_object('action', 'fetch', 'lease', v_lease, 'quote', v_quote);
end;
$$;

create function public.av_finish_quote(
  p_symbol text,
  p_lease uuid,
  p_price numeric,
  p_trading_date date,
  p_rate_limited boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_cache public.av_quote_cache%rowtype;
begin
  -- Užraktų tvarka visada vienoda: bendra valdymo eilutė, tada talpykla.
  perform 1 from public.av_api_control where id = 1 for update;
  v_now := clock_timestamp();
  select * into v_cache from public.av_quote_cache where symbol = p_symbol for update;
  if not found or p_lease is null or v_cache.lease is distinct from p_lease
     or v_cache.lease_until <= v_now then
    raise exception 'Kainos atnaujinimo rezervacija nebegalioja';
  end if;

  if p_rate_limited then
    update public.av_api_control set paused_until = v_now + interval '1 hour' where id = 1;
  end if;
  if p_price is not null then
    if p_price <= 0 or p_price >= 'Infinity'::numeric
       or p_price >= 1000000000000 or round(p_price, 6) <> p_price
       or p_trading_date is null
       or p_trading_date > (v_now at time zone 'UTC')::date
       or p_trading_date < (v_now at time zone 'UTC')::date - 7 then
      raise exception 'Netinkama dienos kaina';
    end if;
    update public.av_quote_cache
      set price = p_price, trading_date = p_trading_date, fetched_at = v_now
      where symbol = p_symbol;
  end if;
  update public.av_quote_cache set lease = null, lease_until = null where symbol = p_symbol;
end;
$$;

-- Funkcijų numatytosios PUBLIC teisės aiškiai panaikinamos.
revoke all privileges on function public.av_reserve_quote(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.av_finish_quote(text, uuid, numeric, date, boolean)
  from public, anon, authenticated, service_role;
grant usage on schema public to service_role;
grant execute on function public.av_reserve_quote(text) to service_role;
grant execute on function public.av_finish_quote(text, uuid, numeric, date, boolean) to service_role;

commit;