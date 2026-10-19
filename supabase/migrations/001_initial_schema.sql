-- Pradinė mokomojo TRADING-SIMULATOR schema, skirta Supabase SQL Editor.
-- Vienkartinė migracija: lentelės šiais vardais dar neturi egzistuoti.
-- Virtuali valiuta – USD; akcijų kiekiai – sveikieji, komisinių nėra.
begin;

-- Profilis priklauso vienam Supabase Auth vartotojui.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  cash_balance numeric(18,2) not null default 10000.00,
  created_at timestamptz not null default now(),
  check (cash_balance >= 0 and cash_balance < 'Infinity'::numeric)
);

-- Vartotojo stebimos akcijos.
create table public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references public.profiles(id) on delete cascade,
  symbol text not null,
  created_at timestamptz not null default now(),
  check (char_length(symbol) between 1 and 32
    and symbol = upper(btrim(symbol)) and symbol !~ '[[:space:]]'),
  unique (user_id, symbol)
);

-- Įvykdyti sandoriai. Rašys tik būsima patikima serverio funkcija.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity integer not null check (quantity > 0),
  price numeric(18,6) not null check (price > 0 and price < 'Infinity'::numeric),
  -- Suma apskaičiuojama automatiškai ir apvalinama iki centų.
  total_amount numeric(18,2)
    generated always as (round(quantity::numeric * price, 2)) stored not null,
  quote_at timestamptz not null,
  executed_at timestamptz not null default now(),
  check (char_length(symbol) between 1 and 32
    and symbol = upper(btrim(symbol)) and symbol !~ '[[:space:]]'),
  check (total_amount > 0),
  -- Pakartojant užklausą reikia naudoti tą patį request_id.
  unique (user_id, request_id)
);

-- Turimos akcijos. Pardavus visas akcijas, serveris pašalina pozicijos eilutę.
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  quantity integer not null check (quantity > 0),
  average_cost numeric(18,6) not null
    check (average_cost > 0 and average_cost < 'Infinity'::numeric),
  -- Keičiant poziciją laiką atnaujins serverio funkcija.
  updated_at timestamptz not null default now(),
  check (char_length(symbol) between 1 and 32
    and symbol = upper(btrim(symbol)) and symbol !~ '[[:space:]]'),
  unique (user_id, symbol)
);

-- Portfelio vertės istorija būsimiems grafikams. Automatinio kaupimo dar nėra.
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  captured_at timestamptz not null default now(),
  cash_balance numeric(18,2) not null
    check (cash_balance >= 0 and cash_balance < 'Infinity'::numeric),
  holdings_value numeric(18,2) not null
    check (holdings_value >= 0 and holdings_value < 'Infinity'::numeric),
  unique (user_id, captured_at)
);

-- UNIQUE apribojimai jau sukuria indeksus pagal user_id.
-- Papildomas indeksas reikalingas sandorių istorijai pagal laiką.
create index transactions_user_executed_idx
  on public.transactions(user_id, executed_at desc);

-- RLS įjungiamas visose penkiose lentelėse.
alter table public.profiles enable row level security;
alter table public.watchlist enable row level security;
alter table public.transactions enable row level security;
alter table public.positions enable row level security;
alter table public.snapshots enable row level security;

-- Panaikinamos galimos numatytosios API prieigos teisės.
revoke all privileges on table
  public.profiles, public.watchlist, public.transactions,
  public.positions, public.snapshots
from public, anon, authenticated;

-- Prisijungę vartotojai gali skaityti tik RLS leidžiamas eilutes.
grant usage on schema public to authenticated;
grant select on table
  public.profiles, public.watchlist, public.transactions,
  public.positions, public.snapshots
to authenticated;

-- Vartotojas gali pridėti ir šalinti tik savo stebimas akcijas.
grant insert (user_id, symbol) on public.watchlist to authenticated;
grant delete on public.watchlist to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy watchlist_select_own on public.watchlist
  for select to authenticated using (user_id = (select auth.uid()));
create policy watchlist_insert_own on public.watchlist
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy watchlist_delete_own on public.watchlist
  for delete to authenticated using (user_id = (select auth.uid()));
create policy transactions_select_own on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy positions_select_own on public.positions
  for select to authenticated using (user_id = (select auth.uid()));
create policy snapshots_select_own on public.snapshots
  for select to authenticated using (user_id = (select auth.uid()));

-- Kitų rašymo teisių ir politikų vartotojams nėra: jie negali tiesiogiai
-- keisti balanso, pozicijų, sandorių ar portfelio vertės istorijos.
-- service_role apeina RLS ir skirtas tik patikimai serverio daliai.
-- Jo slaptas raktas negali būti React kode ar VITE_* kintamuosiuose.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.profiles, public.watchlist, public.transactions,
  public.positions, public.snapshots
to service_role;

-- Registracijos metu profilis sukuriamas vieną kartą su 10 000 USD.
-- Tuščias search_path ir pilni objektų vardai apsaugo funkcijos vykdymą.
create function public.trading_simulator_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, cash_balance)
  values (new.id, 10000.00)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Funkciją kviečia trigeris; klientui jos vykdymas nesuteikiamas.
revoke all privileges
  on function public.trading_simulator_handle_new_user()
  from public, anon, authenticated, service_role;

create trigger trading_simulator_on_auth_user_created
  after insert on auth.users
  for each row execute function public.trading_simulator_handle_new_user();

-- Jau esamiems Auth vartotojams sukuriami tik trūkstami profiliai.
-- Esamų profilių balansas nekeičiamas ir neatstatomas.
insert into public.profiles (id, cash_balance)
select id, 10000.00 from auth.users
on conflict (id) do nothing;

-- Būsima sandorio funkcija turės patikrinti prisijungimą ir API kainą,
-- vienoje DB transakcijoje užrakinti profilį (SELECT ... FOR UPDATE),
-- patikrinti request_id, pinigus ar akcijų kiekį ir kartu pakeisti balansą,
-- poziciją bei įrašyti sandorį. Atskiros API užklausos to neužtikrina.
-- Funkciją, priimančią patikrintą kainą, galės kviesti tik patikimas serveris,
-- o ne anon ar authenticated vaidmenys.
commit;