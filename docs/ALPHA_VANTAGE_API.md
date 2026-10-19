# Alpha Vantage dienos kainų API

Serverio sprendimas – Supabase Edge Function. React failai nekeičiami.
Papildomų npm priklausomybių nėra: naudojamos standartinės fetch, Node testavimo
ir Deno serverio priemonės. Tai tik kainų API, be BUY/SELL.

## Plano ribos ir kainų reikšmė

Standartinis nemokamas Alpha Vantage planas: 25 užklausos per dieną.
GLOBAL_QUOTE pateikia vieną simbolį; pagal nutylėjimą duomenys atnaujinami
prekybos dienos pabaigoje. Tai nėra realaus laiko ar 15 minučių vėlavimo API.
Tikslias savo rakto teises reikia patikrinti su tiekėju.

Šaltiniai:
- https://www.alphavantage.co/support/
- https://www.alphavantage.co/documentation/
- https://supabase.com/docs/guides/functions/secrets

Leidžiamos akcijos: AAPL, MSFT, AMZN, GOOGL, META, NVDA, TSLA, IBM, NFLX, AMD.
Simboliai normalizuojami į didžiąsias raides. Sąrašas apribotas JAV akcijomis.
GLOBAL_QUOTE negrąžina valiutos lauko, todėl valiuta savavališkai nenustatoma
pagal trūkstamą API lauką. Plečiant sąrašą reikės atskiro valiutos tikrinimo.

Kainos laikomos bendroje DB talpykloje 24 valandas. Visi vartotojai naudoja
tą pačią talpyklą. DB atomiškai rezervuoja kiekvieną išorinį kvietimą:
ne daugiau kaip 25 per slenkantį 24 valandų laikotarpį, bent 15 sekundžių
tarp kvietimų. Tarpas yra papildoma projekto atsargumo taisyklė.
Nepavykę kvietimai taip pat skaičiuojami; automatinio kartojimo nėra.
Gavus tiekėjo limito klaidą, atnaujinimai stabdomi vienai valandai.
Tos pačios akcijos rezervacija galioja 60 sekundžių, todėl nutraukta funkcija
neužblokuos jos visam laikui. Kitas tos pačios akcijos kvietimas gauna seną
talpyklos kainą arba 503, kol pirmasis atnaujinimas vyksta.

Talpyklos techninis galiojimas ir pačios kainos senumas vertinami atskirai:
- fetched_at yra gavimo laikas, ne kainos prekybos momentas;
- cache_fresh reiškia, kad nuo gavimo praėjo mažiau nei 24 valandos;
- trading_date visada lieka tiekėjo pateikta tikroji prekybos data;
- expected_trading_date yra numatoma paskutinės paskelbtos dienos kainos data;
- price_freshness: recent_daily, outdated_daily arba unverified;
- possibly_stale įspėja apie seną ar nepatvirtintą kainą ir atsarginio atsakymo naudojimą;
- stale yra suderinamumo perspėjimas: possibly_stale ARBA nebegaliojanti talpykla;
- is_realtime visada false; data_type visada end_of_day.

Net recent_daily nereiškia realaus laiko ar garantuotai naujausios tiekėjo kainos.
Kiekvienas sėkmingas atsakymas turi aiškų dienos duomenų perspėjimą.
7 kalendorinės dienos yra absoliuti priimtinumo riba, o ne šviežumo kriterijus:
ką tik gauta savaitės senumo kaina bus outdated_daily ir possibly_stale: true.
Tiekėjo grąžinta ankstesnė data neperrašo naujesnės turimos kainos.

Vertinamas America/New_York laikas (įskaitant vasaros ir žiemos laiką), savaitgaliai,
2026–2028 m. planinės JAV akcijų rinkos šventės ir sutrumpintos sesijos.
Kalendoriaus šaltinis:
https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx

Įprastos sesijos uždarymas vertinamas 16:00, sutrumpintos – 13:00 Niujorko laiku.
Pridedamas 2 valandų rezervas dienos duomenims paskelbti. Tai projekto atsargumo
taisyklė, o ne Alpha Vantage garantija. Iki šios ribos tikimasi ankstesnės sesijos.
Savaitgalį penktadienio kaina ir šventę ankstesnės sesijos kaina gali būti recent_daily,
bet jos visada lieka dienos duomenimis. Kalendorius neapima neplanuotų uždarymų.
Už 2026–2028 m. ribų ar nepavykus nustatyti ankstesnės sesijos naudojamas unverified
ir possibly_stale: true. Kalendorių reikės atnaujinti prieš 2029 m.

002 SQL migracijos šiam pataisymui keisti nereikia. Ji saugo prekybos datą atskirai
nuo gavimo laiko. Jos action=cache reiškia techninį talpyklos naudojimą, o ne
patvirtintą kainos šviežumą; atsakymo metaduomenis apskaičiuoja serveris.
24 valandų TTL ir visos rezervavimo, užraktų bei kvotos taisyklės nekeičiamos.
Kainos senumo įspėjimas pats savaime nepradeda papildomų API kvietimų.
Kituose projektuose tuo pačiu API raktu atlikti kvietimai šioje DB neskaičiuojami.

## Paruošimas administratoriui

Šiame pakeitime SQL nėra vykdomas ir funkcija nėra diegiama.
Toliau pateikti žingsniai skirti vėlesniam rankiniam paleidimui.

1. Atskirame bandomajame Supabase projekte pritaikykite tik
   supabase/migrations/002_alpha_vantage_cache.sql.
   Ši migracija nepriklauso nuo 001 ar vartotojų profilių lentelių.
   Tai vienkartinė migracija, be esamų objektų perrašymo.
2. Supabase Edge Function paslaptyse įrašykite ALPHA_VANTAGE_API_KEY ir
   ALLOWED_ORIGINS (pvz., http://localhost:5173 arba tikslų diegto frontend adresą).
   Kelis adresus atskirkite kableliais, be baigiamojo pasvirojo brūkšnio.
3. SUPABASE_URL ir SUPABASE_SERVICE_ROLE_KEY funkcijai pateikia platforma.
   Administratoriaus raktas naudojamas tik Auth tikrinimui ir dviem RPC.
4. Įdiekite get-quote funkciją. Palikite verify_jwt = true.
   Naudokite projekto palaikomą vartotojo JWT autentifikaciją.
5. Sukurkite ir prijunkite bandomąjį Supabase Auth vartotoją.

Raktas niekada nenaudojamas React, VITE_* kintamuosiuose, atsakyme ar žurnale.
Nežurnaluokite pilno išorinio URL, nes jo apikey parametras yra slaptas.
CORS nėra autentifikacijos pakaitalas: kiekviena GET užklausa papildomai
tikrinama Supabase Auth /user endpointu. OPTIONS tik apdoroja CORS.
DB talpyklos lentelės nepasiekiamos anon ir authenticated vaidmenims.
Rezervavimo ir užbaigimo funkcijas gali kviesti tik service_role.

## Vietinis tikrinimas

Reikia Node 24 (automatiniams testams) ir, funkcijai paleisti, Supabase CLI
su vietinės Supabase aplinkos reikalaujamomis priemonėmis.

Automatiniai testai nenaudoja interneto, API rakto ar tikros DB:

    node --test supabase/functions/tests/get-quote.test.mjs
    npm run build
    npm run lint

Norėdami vėliau paleisti visą vietinę Supabase aplinką, pirmiausia atskirai
pritaikykite migraciją vietinėje DB, nukopijuokite .env.example į .env.local
ir užpildykite tik serverio reikšmes. Failas .env.local ignoruojamas Git.

    supabase functions serve get-quote --env-file .env.local

Vartotojo JWT ir projekto viešą API raktą nustatykite savo terminalo aplinkoje.
Testavimo užklausa (curl):

    curl "https://PROJECT_REF.supabase.co/functions/v1/get-quote?symbol=IBM" -H "Authorization: Bearer USER_ACCESS_TOKEN" -H "apikey: PROJECT_PUBLISHABLE_OR_ANON_KEY"

Vietiniam testui naudokite vietinės funkcijos URL. React čia nekviečiamas.

Sėkmingo atsakymo pavyzdys:

    {
      "symbol": "IBM",
      "price": "240.120000",
      "trading_date": "2026-10-16",
      "source": "Alpha Vantage",
      "data_type": "end_of_day",
      "fetched_at": "2026-10-19T10:00:00.000Z",
      "cached": true,
      "cache_fresh": true,
      "price_freshness": "recent_daily",
      "expected_trading_date": "2026-10-16",
      "possibly_stale": false,
      "stale": false,
      "is_realtime": false,
      "warning": "Tai dienos kaina pagal trading_date, ne realaus laiko kotiruotė."
    }

Pavyzdžio skaičiai nėra tikra dabartinė kotiruotė. price pateikiama dešimtaine
eilute; šiame etape pinigų aritmetika neatliekama.

Patikrinkite:
- be vartotojo žetono arba su netinkamu žetonu prieiga atmetama;
- symbol=../AAPL ir nepalaikomi simboliai grąžina 400;
- pakartotinė tos pačios akcijos užklausa naudoja talpyklą;
- nepavykęs tiekėjo kvietimas nesugadina senos tinkamos kainos;
- ką tik gauta senesnė kaina nėra žymima šviežia;
- savaitgalio ir šventinių dienų paskutinės sesijos kaina nepristatoma kaip realaus laiko;
- kalendoriaus ribos ir 24 valandų talpyklos riba tikrinamos atskirai;
- išnaudojus kvotą be talpyklos grąžinama 429;
- tuo pačiu metu siųstos užklausos nepradeda kelių atnaujinimų;
- anon ir authenticated negali tiesiogiai kviesti av_reserve_quote / av_finish_quote;
- atsakymuose ir naršyklės kode nėra slapto rakto.

Be realios bandomosios DB šie Node testai neįrodo SQL užraktų, GRANT ir RLS
veikimo. Juos būtina atskirai patikrinti bandomojoje Supabase aplinkoje.
Tikras Alpha Vantage kvietimas sunaudos bendro rakto dienos kvotą.