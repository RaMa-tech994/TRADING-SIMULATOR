# Grafikų #16, #17 ir #18 Backend API

Naudojamos 001–005 migracijos. 005 šiame įgyvendinimo etape nekeičiama ir nevykdoma.
Funkcijos parengtos, bet šiame etape nediegiamos.

## Autorizacija ir aplinka

Abu endpointai reikalauja tikro prisijungusio vartotojo Authorization: Bearer JWT.
Supabase klientas taip pat siunčia projekto viešą apikey. Funkcijos papildomai tikrina
vartotoją per Supabase Auth /user, reikalauja authenticated vaidmens ir UUID.
CORS naudoja ALLOWED_ORIGINS. Be Origin užklausos tinka Backend klientams, bet JWT privalomas.
OPTIONS apdoroja tik CORS. Atsakymuose Cache-Control: no-store.
Naujų funkcijų verify_jwt=false, nes JWT patikra privalomai atliekama jų kode.

Serverio aplinka: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
ALPHA_VANTAGE_API_KEY ir ALLOWED_ORIGINS. Administratoriaus raktas naudojamas tik
kainų talpyklų rezervavimo / užbaigimo RPC. Vartotojo istorijos skaitymas ir naujo
taško įrašymas vyksta vartotojo JWT kontekste. Raktai į frontend neperduodami.

## #16: GET /functions/v1/price-history?symbol=AAPL

Priimamas tik vienas symbol iš esamo 10 JAV akcijų sąrašo. Nėra body ar priverstinio
atnaujinimo parametro. Sugrąžinami iki 100 kompaktiškos istorijos taškų didėjančia datos tvarka:

    {
      "symbol": "AAPL",
      "currency": "USD",
      "source": "Alpha Vantage",
      "data_type": "daily_close",
      "adjusted": false,
      "is_realtime": false,
      "points": [{ "date": "2026-10-20", "close": "342.940000" }],
      "latest_trading_date": "2026-10-20",
      "fetched_at": "2026-10-20T23:00:00.000Z",
      "cached": true,
      "cache_fresh": true,
      "price_freshness": "recent_daily",
      "expected_trading_date": "2026-10-20",
      "possibly_stale": false,
      "stale": false,
      "warning": "Dienos duomenys, ne realaus laiko kotiruotė."
    }

Pavyzdys paaiškina formatą; endpointas niekada negeneruoja tokių pavyzdinių taškų.
Naudojamas tikras Alpha Vantage TIME_SERIES_DAILY, outputsize=compact. Kainos
nepakoreguotos dėl splitų / dividendų; close eilutės tikslumas išsaugomas iki 6 skaitmenų.
GLOBAL_QUOTE neapsimeta istorijos tiekėju. Senesni istorijos taškai teisėtai gali būti
senesni nei 7 dienos; naujos serijos paskutinis taškas turi atitikti 005 priimtinumo ribą.

005 av_reserve_price_history ir av_finish_price_history dalijasi ta pačia 002
av_api_control eilute ir av_api_requests žurnalu. Išlieka 25 bandymai / slenkantis
24 val. laikotarpis, 15 s tarpas, 60 s rezervacija ir 1 val. pauzė po tiekėjo limito.
Išorinis API kviečiamas tik action=fetch atveju; nesėkmingi bandymai neatgauna kvotos.

cache_fresh aprašo tik techninį 24 val. galiojimą. Naujausios prekybos datos aktualumas
vertinamas esamu freshness.mjs kalendoriumi. Savaitgalį nerodoma tariama realaus laiko kaina.
Kai atnaujinimas nepavyksta ar kvota išnaudota, galima grąžinti tikrą ankstesnę istoriją,
bet su possibly_stale=true / stale=true ir tikromis datomis. Jei jokios tinkamos
istorijos nėra, gaunama klaida, ne išgalvotos reikšmės.

## #17 ir #18: GET /functions/v1/portfolio-history

GET tik skaito 005 get_portfolio_history RPC. Jis nekviečia kainų API, neįrašo
snapshot ir nekuria praeities duomenų. Tuščias points masyvas reiškia, kad istorijos nėra.
Pasirenkami vienkartiniai parametrai: from, to (UTC ISO laikas su Z), limit (1–500,
numatyta 100). Pavyzdys: ?from=2026-10-01T00:00:00Z&to=2026-10-20T23:59:59.999999Z&limit=100.
Grąžinami naujausi limit taškai, atsakyme surikiuoti didėjančiu laiku. has_more nurodo,
ar tame intervale yra senesnių taškų. SQL intervalų ribos įtraukiamos.

    {
      "currency": "USD",
      "initial_balance": "10000.00",
      "profit_loss_type": "total_since_initial_balance",
      "has_more": false,
      "points": [{
        "captured_at": "2026-10-20T23:00:00+00:00",
        "cash_balance": "9657.06",
        "holdings_value": "342.94",
        "portfolio_value": "10000.00",
        "total_profit_loss": "0.00",
        "valuation_details": { "source": "Alpha Vantage", "data_type": "end_of_day", "is_realtime": false, "prices": {} }
      }]
    }

#17 naudoja captured_at + portfolio_value. #18 naudoja captured_at + total_profit_loss.
P/L = portfelio vertė - 10000 USD: realizuotas IR nerealizuotas rezultatas nuo pradžios,
ne tik dabartinių pozicijų nerealizuotas P/L. Prielaida: nėra papildomų įnašų, išėmimų
ar administracinio balanso atstatymo. Pinigai visada dešimtainės eilutės, ne JS pinigų aritmetika.
valuation_details.prices turi tikro įrašymo metu naudotus simbolius, kiekius, kainas ir datas;
seniems įrašams valuation_details gali būti null. Jo neišgalvojame ir neatkuriame iš dabarties.

## POST /functions/v1/portfolio-history

Tik aiškiai paprašytas naujas DABARTINIS stebėjimas, ne automatinis GET šalutinis veiksmas.
Reikalingas application/json, ne daugiau 4096 baitų, be URL parametrų:

    { "request_id": "11111111-1111-4111-8111-111111111111" }

Naujam stebėjimui klientas sukuria UUID; to paties bandymo pakartojimui naudoja tą patį.
user_id, kainų, sumų, datų ar papildomų laukų siųsti negalima. 005 SQL pats nustato
vartotoją, užrakina profilį ir kainas, patikrina aktualumą bei apskaičiuoja vertę.
Per minutę leidžiamas tik vienas naujas taškas vartotojui.

Pirmiausia kviečiamas capture_portfolio_snapshot. Pakartotas ID grąžinamas net kainai
vėliau pasenus ir be API kvotos. Tik SQL aiškiai grąžinus INCOMPLETE_VALUATION perskaitomos
savos pozicijos ir per esamą quote-service.mjs gaunamos kainos. Jei visos tinkamos,
leidžiamas vienas to paties request_id SQL pakartojimas. SQL viską tikrina iš naujo:
finansinės sumos iš JS niekada neperduodamos. Nepilnas taškas neįrašomas.

Naujas įrašas: HTTP 201. Pakartojimas: HTTP 200. Atsakymas:

    { "success": true, "currency": "USD", "data_type": "end_of_day", "is_realtime": false,
      "replayed": false, "snapshot": {
        "id": "<snapshot UUID>", "request_id": "<kliento UUID>",
        "captured_at": "<DB laikas>", "cash_balance": "9657.06", "holdings_value": "342.94",
        "portfolio_value": "10000.00", "total_profit_loss": "0.00", "valuation_details": {}
      } }

Po tinklo klaidos / timeout / netinkamo sėkmės atsakymo automatinio pakartojimo nėra.
SNAPSHOT_STATUS_UNKNOWN (503) ir retry_with_same_request_id=true reiškia, kad įrašas
GALĖJO būti išsaugotas. Klientas turi kartoti tik su tuo pačiu ID, ne kurti naują.
SNAPSHOT_RETRY po DB blokavimo klaidos taip pat reikalauja to paties ID.

## Klaidos ir ribos

400 netinkami parametrai; 401 JWT; 403 neleistinas Origin; 405 metodas; 413 dydis;
415 Content-Type; 404 nerastas profilis; 409 nepilnas vertinimas; 422 vertės riba;
429 kvota, tarpas arba SNAPSHOT_TOO_SOON; 502 tiekėjo / istorijos formatas;
503 paslauga nesukonfigūruota, nepatvirtintas kalendorius arba neaiški įrašymo baigtis.
Klaidose nepateikiami žali tiekėjo, SQL, prisijungimo URL ar raktų tekstai.

Palaikomas esamas 2026–2028 metų kalendorius. GET istorija gali rodyti tikrus senesnius
taškus, bet nauji stebėjimai su pozicijomis už kalendoriaus ribų saugiai atmetami.
Nėra foninio kaupimo, istorinio portfelio atkūrimo, BUY/SELL pakeitimų ar papildomų npm paketų.

## Vietiniai testai

    node --test supabase/functions/tests/price-history.test.mjs supabase/functions/tests/portfolio-history.test.mjs supabase/functions/tests/history-sql.test.mjs

HTTP / tiekėjo atsakymai imituoti. history-sql.test.mjs naudoja 001–005 tik vietinėje
PGlite atminties DB ir tikrina realias teises, bendrą 002/005 kvotą, vartotojų atskyrimą,
P/L, minutės ribojimą, pakartojimą ir atsakymo praradimą. Auth parašas ir išorinis API
tebėra imituojami. Reikalingas jau naudotas laikinas PGlite modulis arba PGLITE_MODULE_PATH;
jo nesant, SQL testas pažymimas skipped. Bendras Supabase projektas nenaudojamas.

Prieš diegimą: įsitikinti, kad būtent šios versijos 005 RPC įdiegtos, patikrinti Deno
aplinką ir tikrą vartotojo JWT atskirame bandomajame projekte. Diegti tik naujas
price-history ir portfolio-history funkcijas; šiame etape diegimas neatliekamas.

## Istorijos naršyklės prieiga

Istorijos funkcijos sujungia esamą ALLOWED_ORIGINS su pasirenkamu
HISTORY_ALLOWED_ORIGINS (kableliais atskirti tikslūs svetainių adresai).
Papildomas sąrašas taikomas tik price-history ir portfolio-history;
kitų funkcijų CORS konfigūracija nesikeičia. Vietinei aplinkai galima
įrašyti http://localhost:5174; produkcijos adresas turi būti leidžiamame sąraše.

Istorijos puslapio mygtukas įrašo tik dabartinį portfelio stebėjimą.
Vienam bandymui naudojamas vienas request_id; neaiškios baigties atveju
jis išsaugomas sessionStorage pagal vartotoją ir kartojamas tik rankiniu būdu.
Sėkmės atveju portfelio grafikai perskaitomi iš API. Naujų taškų minutės
ribą užtikrina serveris, papildomai sąsajoje rodoma 60 sekundžių pauzė.
