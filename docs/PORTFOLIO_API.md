# Portfelio vertinimo API

Naujas GET /functions/v1/portfolio endpointas. Parametrų ir body nėra.
Klientas kviečia supabase.functions.invoke('portfolio', { method: 'GET' }) prisijungęs.
Siunčiami projekto viešas apikey ir vartotojo Authorization: Bearer JWT.
JWT privalomai patikrinamas per Supabase Auth /user; user_id iš kliento nepriimamas.
CORS naudoja serverio ALLOWED_ORIGINS sąrašą. Atsakymas nenaudojamas bendrai talpyklai.

## Duomenų formatas Frontend komandai

Pavyzdys, kai turima 1 AAPL, o vidutinė įsigijimo ir API kaina yra 342.94 USD:

```json
{
  "currency": "USD",
  "data_type": "end_of_day",
  "is_realtime": false,
  "snapshot_at": "2026-10-20T23:00:00+00:00",
  "valued_at": "2026-10-20T23:00:01.000Z",
  "valuation_complete": true,
  "missing_symbols": [],
  "cash_balance": "9657.06",
  "positions": [{
    "symbol": "AAPL",
    "quantity": 1,
    "average_cost": "342.940000",
    "current_price": "342.940000",
    "trading_date": "2026-10-20",
    "fetched_at": "2026-10-20T22:00:00.000Z",
    "source": "Alpha Vantage",
    "market_value": "342.94",
    "unrealized_profit_loss": "0.00",
    "valuation_status": "valued",
    "price_freshness": "recent_daily",
    "possibly_stale": false,
    "cache_fresh": true,
    "issue": null
  }],
  "valued_positions_market_value": "342.94",
  "holdings_market_value": "342.94",
  "total_portfolio_value": "10000.00",
  "total_unrealized_profit_loss": "0.00",
  "warning": "Dienos duomenys, ne realaus laiko kaina."
}
```

Pinigai ir kainos grąžinami dešimtainėmis eilutėmis, quantity – sveiku skaičiumi.
Frontend neturi laikyti null nuliu ar rodyti dalinės sumos kaip viso portfelio vertės.

Pozicijų valuation_status:
- valued: tinkama dienos kaina, vertės apskaičiuotos;
- unavailable: tinkamos kainos gauti nepavyko; kainos ir vertės null;
- outdated_or_unverified: gauta sena arba nepatvirtinta kaina. Jos tikra data ir
  kaina pateikiamos perspėjimui, bet market_value ir unrealized_profit_loss yra null.

Kai bent viena pozicija neįvertinta: valuation_complete=false, missing_symbols
nurodo simbolius, holdings_market_value, total_portfolio_value ir
 total_unrealized_profit_loss yra null. valued_positions_market_value yra tik
sėkmingai įvertintų pozicijų suma. cash_balance vis tiek tikras.
Kai pozicijų nėra, pilnas vertinimas lygus balansui ir kainų API nekviečiama.

## Skaičiavimai ir duomenų aktualumas

- Pozicijos rinkos vertė = quantity * API dienos kaina.
- Nerealizuotas P/L = quantity * (API dienos kaina - average_cost).
- Bendra vertė = cash_balance + įvertintų pozicijų rinkos vertės, tik kai įvertintos visos.

Naudojama BigInt aritmetika su 6 dešimtainiais skaitmenimis; JS Number pinigų
aritmetikai nenaudojamas. Pozicijos vertė ir P/L nepriklausomai apvalinami iki centų,
pusė cento – nuo nulio. Bendros sumos sudedamos iš suapvalintų pozicijų reikšmių,
kad sutaptų su rodomomis eilutėmis. P/L apskaičiuojamas pagal DB vidutinę savikainą,
saugomą 6 skaitmenų tikslumu; tai nėra realizuoto pelno ar komisinių apskaita.

Vertinimui naudojama neapvalinta API kaina. Tai portfelio įvertis, ne būsimo BUY/SELL
vykdymo kainos pažadas. Esama prekybos vieneto kainos apvalinimo politika nekeičiama.

Naudojama ta pati quote-service.mjs kaip get-quote ir trade: 002 talpykla, bendra
API kvota ir rezervacijos. Nėra priverstinio atnaujinimo, automatinio kartojimo ar
kvotos apėjimo. Kainos gaunamos nuosekliai. Pagal esamą 15 sekundžių API tarpą ir
25 bandymų / 24 val. kvotą, kelių dar neužkrautų simbolių vertinimas gali būti nepilnas.
Netinkamų kainų išgalvotomis kainomis ar average_cost nepakeičiame.

Gavimo laikas vertinamas atskirai nuo prekybos datos. Perskaičiuojama esamu
freshness.mjs kalendoriumi; savaitgaliai ir šventės nesukuria realaus laiko kainų.
Sena, atsarginė, pasibaigusios talpyklos ar nepatvirtinta kaina į bendras sumas neįtraukiama.
Palaikomas planinis 2026–2028 m. kalendorius, neplanuoti uždarymai neįtraukti.

## Nuoseklus skaitymas, saugumas ir diegimas

004_portfolio_snapshot.sql prideda tik skaitymo RPC get_portfolio_snapshot().
Vienas STABLE SQL SELECT perskaito balansą ir visas pozicijas tuo pačiu DB snapshot.
SECURITY INVOKER taiko esamas lentelių teises ir RLS. EXECUTE leidžiamas tik
 authenticated; filtrai papildomai tikrina auth.uid() ir auth.role(). Numerinės
cash_balance ir average_cost reikšmės konvertuojamos į text prieš JSON, išsaugant tikslumą.
RPC kaina nevertinama ir jokie finansiniai įrašai nekeičiami. Jei profilis nerastas – 404.

Endpointas kainas skaito jau po DB snapshot: tai vertinimas pagal nurodytas kainų
prekybos datas, ne bendra biržos ir DB atominė laiko nuotrauka. Atsakyme atskirti
snapshot_at, valued_at ir kiekvienos kainos trading_date bei fetched_at.

Serverio aplinka: SUPABASE_URL, SUPABASE_ANON_KEY finansiniam skaitymui,
SUPABASE_SERVICE_ROLE_KEY tik 002 kainų RPC, ALPHA_VANTAGE_API_KEY ir ALLOWED_ORIGINS.
Naujame portfolio config.toml įraše verify_jwt=false: funkcijos kodas pats reikalauja
Supabase Auth patvirtinto vartotojo. Vien viešo apikey užklausai nepakanka.
Kainų RPC administratoriaus raktas nenaudojamas vartotojo finansiniams duomenims skaityti.

Parengta, bet NEĮDIEGTA. Naują 004 migraciją pirmiausia pritaikyti atskirame bandomajame
projekte su 001–003; tik tada diegti portfolio funkciją. Šioje užduotyje bendros DB
migracijos ir Edge Function diegimas nevykdomi. JWT/gateway ir tikri kelių sesijų
skaitymai dar turi būti patikrinti Supabase bandomajame projekte.

## Vietiniai testai

```powershell
node --test supabase/functions/tests/portfolio.test.mjs supabase/functions/tests/portfolio-sql.test.mjs
```

SQL testas veikia tik vietinėje PGlite atminties DB su imituotu Auth, ne Supabase.
Naudoja jau esantį laikiną PGlite paketą iš docs/BUY_SELL_DATABASE.md arba
PGLITE_MODULE_PATH kelią. Jei jo nėra, SQL testas pažymimas skipped; aritmetikos ir
HTTP testams papildomų paketų nereikia. Migracijų testas pritaiko 001–004, tikrina
RLS su dviem vartotojais, anon/service_role teises ir tikslius skaičius.

## Portfelio puslapis

Portfelio puslapis skaito prisijungusio vartotojo duomenis per GET portfolio.
Demonstraciniai 5000 USD ir pavyzdinės akcijos pašalinti. Naujam vartotojui
rodoma API grąžinta vertė (įprastai 10000.00 USD), ne frontend nustatytas balansas.
Tuščias pozicijų sąrašas rodomas kaip tuščias; nepilno vertinimo null sumos
nerodomos kaip nulis. Yra krovimo, neprisijungusio vartotojo ir klaidos būsenos.

Tik portfolio funkcijai galima papildyti CORS sąrašą per PORTFOLIO_ALLOWED_ORIGINS
(kableliais atskirti tikslūs adresai). Esamas ALLOWED_ORIGINS išlieka.
Vietinei aplinkai sukonfigūruota http://localhost:5174. Kolegų vietinis ar Vercel
adresas taip pat turi būti viename iš šių sąrašų; visi adresai automatiškai neleidžiami.
