# BUY/SELL backend

Parengta 003_buy_sell.sql ir trade Edge Function. Migracija neįvykdyta Supabase,
funkcija neįdiegta. Frontend failai nekeičiami.
Pirma turi būti pritaikytos 001 ir 002. Migracijos savininkas turi būti patikimas
(Supabase SQL Editor paprastai postgres). 003 vienkartinė, ne pakartotinio vykdymo.

## Vieša sąsaja ir tapatybė

- public.buy_stock(p_request_id uuid, p_symbol text, p_quantity integer)
- public.sell_stock(p_request_id uuid, p_symbol text, p_quantity integer)

Kviečiama per Supabase RPC su prisijungusio vartotojo JWT.
Parametrų user_id ir price nėra. Vartotojas nustatomas iš auth.uid(), papildomai
tikrinama auth.role() = authenticated. JWT parašą turi patikrinti Supabase API;
savavališkai nustatyti JWT duomenis gali tik testų administratorius, ne naršyklė.

trade Edge Function finansinį RPC kviečia vartotojo JWT kontekste.
Administratoriaus service_role raktas čia NETINKA: jam EXECUTE nesuteiktas.
Jis ir toliau naudojamas tik atskiram kainų gavimui bei 002 talpyklos RPC.
getUser() patikrina JWT per Supabase Auth /user ir perduoda patvirtintą vartotoją.
get-quote suderinamumui išlieka authenticate() su boolean rezultatu.

Pradiniai 10000 USD lieka 001 registracijos trigerio atsakomybė. Pakartotinis
prisijungimas ir ši migracija balanso neatstato. Esamos RLS skaitymo politikos
nekeičiamos; tiesioginis vartotojo finansinių lentelių rašymas ir toliau draudžiamas.
service_role visos finansinių lentelių teisės atšaukiamos, įskaitant galimą numatytąją
TRUNCATE teisę; paliekamas tik SELECT.
Privilegijuotas DB savininkas vis tiek gali administruoti duomenis.

## Kainos ir kvota

Kaina skaitoma tik iš 002 av_quote_cache su FOR SHARE užraktu. Pinigų funkcijos
nekviečia Alpha Vantage ir nekeičia 002 kvotos, kontrolės ar rezervacijų.
Trūkstant kainos ją turi atskirai gauti serverio kainų paslauga.

Reikalaujama:
- teigiamos baigtinės kainos;
- gavimo laiko praeityje, mažiau nei prieš 24 valandas;
- kalendoriuje tikros ir ne senesnės už numatomą paskutinę sesiją prekybos datos;
- ne senesnės nei 7 kalendorinės dienos datos kaip papildomos priimtinumo ribos.

Nėra jokios automatinės išimties pasenusiai kainai, net jeigu ją galima rodyti
get-quote peržiūroje su perspėjimu. Savaitgaliai, 2026–2028 m. planinės šventės,
sutrumpintos sesijos ir 2 valandų paskelbimo rezervas sutampa su freshness.mjs.
Už kalendoriaus ribų gaunama QUOTE_UNVERIFIED. Neplanuoti uždarymai neįtraukti.
Tai dienos kainos, ne realaus laiko kotiruotės. Kalendorių reikės prižiūrėti abiejose
vietose; vietinis testas palygina SQL ir JS visą palaikomą laikotarpį kas 6 valandas.

transactions papildoma quote_trading_date, quote_fetched_at, quote_source ir quote_price.
Seni quote_at duomenys neliečiami. Nauji dienos sandoriai quote_at palieka NULL:
tikslaus kainos momento Alpha Vantage GLOBAL_QUOTE nepateikia.

## Atomiškumas, užraktai, pakartojimas

Visos finansinės funkcijos užrakina profilį FOR UPDATE, tada tikrina request_id.
Kainą užrakina FOR SHARE, poziciją FOR UPDATE. 002 turi tvarką kontrolė -> kaina;
prekybos funkcijos kontrolės eilutės neliečia. Kainos galiojimas tikrinamas po
laukimo ties profiliu ir kaina. Profilio užraktas apsaugo ir naujos pozicijos kūrimą.

Balansas, pozicija ir transactions įrašas pakeičiami vienoje funkcijos transakcijoje.
Klaidos neišsaugomos kaip sėkmė: jos perduodamos PostgreSQL ir atšaukia operaciją.
Pakartotinis sėkmingas request_id su tais pačiais normalizuotais parametrais grąžina
tą patį sandorį su replayed=true, net kainai pasenus. Kiti parametrai su tuo pačiu
vartotojo ID ir request_id sukelia REQUEST_ID_CONFLICT. Skirtingiems vartotojams
tas pats request_id leidžiamas. Nesėkmingas pavedimas ID nerezervuoja.

Grąžinamas transaction ir replayed. Dabartinį portfelį klientas vėliau perskaito
atskirai; ankstesnio pavedimo pakartojimas neturi grąžinti išgalvoto seno balanso.
Vienas SQL iškvietimas atominis; iš kelių finansinių RPC sudarančių ilgesnę DB
transakciją integracijų ši pirmoji versija nenumato. Taikomas įprastas READ COMMITTED;
aukštesniuose izoliavimo lygiuose galimas saugus serialization_failure ir pakartojimas.

## Pinigų apvalinimo politika

Kiekiai sveiki teigiami, be komisinių. Serveris vieną kartą apvalina vienos akcijos
API kainą iki USD centų (PostgreSQL numeric round: pusė cento apvalinama aukštyn,
nes kainos teigiamos). Tik tada ši vykdymo kaina dauginama iš kiekio.
BUY ir SELL naudoja tą patį įkainį. Bendrai sumai papildomo apvalinimo nereikia.

Pavyzdys: API kaina 0.015 USD -> vykdymo kaina 0.02 USD.
BUY 2 kainuoja 0.04 USD; vienas SELL 2 ir du SELL 1 grąžina vienodai 0.04 USD.
Taip pat 100.005 USD -> 100.01 USD, nepriklausomai nuo pavedimo dydžio.
Tai mokomojo projekto vykdymo kainos taisyklė; kaina nėra nepakitusi API reikšmė.

transactions.quote_price išsaugo pirminę API kainą 6 skaitmenų po kablelio tikslumu,
transactions.price – tikrąjį vykdymo įkainį, total_amount – quantity * price.
Naujiems sandoriams CHECK apribojimas užtikrina price = round(quote_price, 2).
Esami seni sandoriai išsaugomi nepakeisti su quote_price=NULL.
003 dar netaikyta šiame etape; jei senesnė 003 versija jau būtų pritaikyta kitoje
aplinkoje, jos nekartoti: ten reikėtų atskiros papildomos migracijos.

Iki nulio apvalinama vieneto kaina atmetama net jei didelis bendras kiekis sudarytų
centą. Pvz., 0.004999 atmetama, 0.005 vykdoma po 0.01 USD.
Taip pat atmetamas normalizuotos kainos ar bendros sumos perpildymas.
Balansas saugomas centais; nuskaitoma / įskaitoma tiksliai tiek, kiek įrašyta istorijoje.
BUY savikaina skaičiuojama iš šios realiai nuskaičiuotos sumos; average_cost saugoma
6 skaitmenų po kablelio tikslumu. Dalinis SELL vidutinės savikainos nekeičia.
Pilnas SELL pašalina poziciją. Vartotojas pats vykdymo kainos nustatyti negali.

Regresiniai testai lygina didelius ir mažus BUY / SELL, kartoja ankstesnės spragos
ciklą, tikrina pusės cento ribas, mažus dydžius, maksimalias sumas, kiekius,
visos istorijos ir balanso suderinamumą, request_id ir atšaukimą po klaidos.

## Klaidos

UNAUTHORIZED (28000); INVALID_REQUEST (22023); INVALID_AMOUNT, POSITION_LIMIT,
INVALID_AVERAGE_COST, BALANCE_LIMIT (22003); kitos verslo klaidos (P0001):
PROFILE_NOT_FOUND, REQUEST_ID_CONFLICT, QUOTE_UNAVAILABLE, QUOTE_CACHE_EXPIRED,
QUOTE_UNVERIFIED, QUOTE_STALE, INVALID_QUOTE, INSUFFICIENT_FUNDS, INSUFFICIENT_SHARES.
Neleidžiami tiesioginiai kvietimai atmetami 42501 dar iki funkcijos vykdymo.

## Vietiniai automatiniai testai

Projekto npm priklausomybės nekeičiamos. Izoliuotas PGlite paketas reikalingas tik
testų vykdymui be veikiančio PostgreSQL serverio. PowerShell pavyzdys:

    $testToolsPath = Join-Path $env:TEMP 'trading-simulator-sql-tools'
    npm install --prefix $testToolsPath --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.3.14
    $pgliteModule = Join-Path $testToolsPath 'node_modules/@electric-sql/pglite/dist/index.js'
    node scripts/test-buy-sell-sql.mjs $pgliteModule
    node --test supabase/functions/tests/get-quote.test.mjs supabase/functions/tests/trade.test.mjs

Runneris atmintyje imituoja Auth schemas ir vaidmenis, pritaiko visas migracijas,
patikrina seno sandorio išsaugojimą, kalendoriaus atitikimą ir abu SQL testų failus.
SQL failo paskutinė komanda ROLLBACK pašalina testų duomenis ir klaidos trigerį.
Tikro Supabase JWT, REST RPC maršrutizavimo ir kelių sesijų blokavimų runneris netikrina.
Failų supabase/tests/003_buy_sell.test.sql ir 003_buy_sell_rounding.test.sql bendrame
komandos projekte nevykdyti.

## Kelių sesijų scenarijai tik atskiroje bandomojoje PostgreSQL bazėje

Kiekvieną scenarijų pradėti nuo naujos izoliuotos bazės su 001–003.
Administratoriaus sesijoje sukurti vieną testinį auth.users vartotoją su UUID
f0000000-0000-4000-8000-000000000001. Leisti trigeriui sukurti profilį.
Į av_quote_cache įrašyti IBM kainą 100, fetched_at=clock_timestamp() ir
trading_date=trading_private.expected_trading_date(clock_timestamp()).
Patikrinti, kad kalendorius žinomas. Nekeisti bendros komandos bazės.

Abiejose atskirose sesijose pradėti transakciją ir nustatyti bandomąją tapatybę:

    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';

1. Dvi BUY operacijos, lėšų pakanka tik vienai:
   sesija A vykdo buy_stock('f0000000-0000-4000-8000-000000000010','IBM',80)
   ir dar nevykdo COMMIT. Sesija B vykdo tą patį kiekį su ID ...000011.
   B turi laukti A. Po A COMMIT B gauna INSUFFICIENT_FUNDS; B vykdo ROLLBACK.
   Rezultatas: 2000 USD, 80 IBM, vienas sandoris.

2. Vienodas request_id:
   kartoti naujoje bazėje; A ir B perka 80 tuo pačiu ID ...000010.
   B laukia A COMMIT ir grąžina replayed=true. Rezultatas tas pats: vienas BUY.
   B taip pat užbaigia COMMIT.

3. Tas pats ID su kitais parametrais:
   A perka 80 su ID ...000010, B perka 1 tuo pačiu ID.
   Po A COMMIT B gauna REQUEST_ID_CONFLICT ir vykdo ROLLBACK.

4. Du SELL:
   naujoje bazėje pirmiausia nupirkti 80 IBM. A parduoda 60 ir laiko transakciją.
   B parduoda 60 kitu ID ir laukia. Po A COMMIT B gauna INSUFFICIENT_SHARES.
   Lieka 20 IBM; įvykdytas tik vienas pardavimas.

5. Laukimas ir pasenusi kaina:
   A administratoriaus sesija užrakina profilį FOR UPDATE. B išsiunčia BUY.
   A nustato IBM fetched_at=clock_timestamp()-interval '2 days' ir COMMIT.
   B, gavusi užraktą, turi atmesti BUY su QUOTE_CACHE_EXPIRED ir nekeisti pinigų.

6. Kainos keitimas vykdymo metu:
   A įvykdo BUY, bet ne COMMIT. B administratoriaus sesija bando pakeisti tą pačią
   talpyklos eilutę. B laukia A COMMIT; sandoris išsaugo A užrakintą kainą.

Šie kelių sesijų scenarijai parengti, bet PGlite vienos sesijos runneriu neįrodomi.
## trade Edge Function API

POST /functions/v1/trade su vartotojo Authorization: Bearer <JWT>, projekto
viešu apikey ir Content-Type: application/json. ALLOWED_ORIGINS naudoja tą patį
konkretų leidžiamų svetainių sąrašą kaip get-quote. Užklausos be Origin tinka
serverio klientams, tačiau vis tiek reikalauja tikro vartotojo prisijungimo.
CORS nėra autentifikacijos pakaitalas. OPTIONS tik apdoroja preflight.

JSON:
    {
      "symbol": "IBM",
      "side": "BUY",
      "quantity": 2,
      "request_id": "22222222-2222-4222-8222-222222222222"
    }

BUY/SELL priimamas ir mažosiomis raidėmis; simbolis normalizuojamas.
quantity turi būti JSON sveikasis skaičius 1..2147483647, request_id – UUID.
Leidžiami tik šie keturi laukai. price, quote_price, user_id, sumos ir papildomi
query parametrai atmetami. Maksimalus užklausos turinys – 4096 baitai.

Vykdymo seka:
1. JWT papildomai patikrinamas per Supabase Auth /user.
2. Atliekamas atominis buy_stock arba sell_stock RPC su tuo pačiu vartotojo JWT.
   SQL pats skaito serverio talpyklą ir pirmiausia patikrina request_id.
3. Jeigu SQL aiškiai atmeta pavedimą dėl trūkstamos arba pasenusios kainos,
   naudojama bendra su get-quote quote-service.mjs paslauga: 002 rezervacija,
   Alpha Vantage kvota, tiekėjo tikrinimas ir kainos išsaugojimas.
4. Tik gavus tinkamą kainą atliekamas vienas to paties RPC pakartojimas.
   Kaina neperduodama parametru; galutinė kaina ir galiojimas sprendžiami SQL.
   Pasenęs, atsarginis arba nepatvirtintas kainos atsakymas naujam bandymui netinka.

Nėra automatinio prekybos RPC kartojimo po tinklo klaidos, timeout ar neaiškaus
serverio atsakymo. SQL galėjo jau įvykdyti pavedimą. Tokiu atveju grąžinamas
TRADE_STATUS_UNKNOWN ir retry_with_same_request_id=true. Klientas privalo
naudoti tą patį request_id, kol išsiaiškina būtent šio pavedimo rezultatą.
Pakartojimas iš DB grąžinamas net neveikiant kainų tiekėjui ar pasenus kainai.
REQUEST_ID_CONFLICT reiškia, kad ID jau panaudotas kitiems parametrams.

Sėkmė: HTTP 201 naujam sandoriui, HTTP 200 pakartotiniam. Atsakyme success,
request_id, replayed, transaction, currency=USD, data_type, is_realtime=false
ir dienos duomenų perspėjimas. transaction yra tikrai išsaugotas DB sandoris,
o ne prieš vykdymą gauta peržiūros kotiruotė. price yra SQL normalizuota vieneto
vykdymo kaina, quote_price – neapvalinta API kaina, total_amount – vykdymo suma.
Pinigai atsakyme pateikiami dešimtainėmis EILUTĖMIS. Jie išsaugomi prieš JS
JSON skaičių konvertavimą, todėl neprarandami centai net ties DB tipo riba.
quantity lieka saugiu sveikuoju JSON skaičiumi. Seno sandorio quote_price ir
dienos metaduomenys gali būti NULL; tikroji istorija nėra išgalvojama.

Klaidos:
- 400: netinkami laukai, kiekis, UUID, JSON arba query parametrai.
- 401: trūkstamas / netinkamas JWT arba ne vartotojo vaidmuo.
- 403: neleistina svetainė.
- 409: INSUFFICIENT_FUNDS, INSUFFICIENT_SHARES, REQUEST_ID_CONFLICT, QUOTE_STALE.
- 413 / 415: per didelis turinys / netinkamas Content-Type.
- 422: netinkama pinigų suma ar tipo riba.
- 429: kainų tiekėjo ar bendros talpyklos kvota.
- 502 / 503: nepasiekiama kainų, Auth ar prekybos paslauga, nepatvirtinta baigtis.

Aplinkos reikšmės tik serveryje:
ALPHA_VANTAGE_API_KEY, ALLOWED_ORIGINS; platformos SUPABASE_URL,
SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Administratoriaus raktas naudojamas
tik kainų RPC. Finansinis RPC naudoja vartotojo Bearer ir SUPABASE_ANON_KEY kaip
projekto apikey. Raktai nežurnaluojami ir negrąžinami klaidose. Naujų npm
priklausomybių nėra, naudojamas standartinis fetch.

Vėlesniam vietiniam paleidimui (šioje užduotyje nepaleidžiama ir nediegiama):

    supabase functions serve trade --env-file .env.local

Būtina atskirai paruošta bandomoji DB su 001–003. Komandos failas config.toml
turi functions.trade.verify_jwt=true. Vietinė .env.local niekada neįtraukiama į Git.

Automatiniai HTTP testai imituoja Auth ir išorinius atsakymus. Papildomas
trade-sql-scenarios.mjs per PGlite paleidiklį tikrina pilną HTTP handlerio,
REST adapterio ir tikrų 001–003 SQL funkcijų kelią. SQL vaidmenys ir RLS veikia
vietinėje DB, tačiau Auth HTTP ir JWT parašo tikrinimas tebėra imituojami.
Testuojamas ir jau įvykdyto SQL atsakymo praradimas bei saugus pakartojimas.
Joks testas nenaudoja tinklo ar bendros Supabase DB.

Prieš diegimą dar reikia realaus vartotojo JWT, Supabase gateway / REST RPC,
Deno aplinkos ir kelių atskirų DB sesijų lygiagretumo bandymų bandomajame projekte.
## React prekybos integracija

Trading puslapis nebeskaičiuoja demonstracinio balanso ir nebevykdo sandorių
naršyklės atmintyje. Autentifikuotas POST trade siunčia tik symbol, side,
quantity ir request_id. Kainą, sumą, balanso ir pozicijų pakeitimus bei
transactions įrašą nustato esamas atominis serverio RPC. Finansiniai duomenys
saugomi DB; frontend jų nekuria ir neatstato prisijungiant.

Po sėkmės balansas ir pozicijos vėl skaitomi per GET portfolio. Demonstracinės
kainos pašalintos; faktinė vykdymo suma rodoma tik iš patvirtinto atsakymo.
Naršyklės localStorage pagal vartotoją saugo tik nebaigto pavedimo parametrus
ir UUID, ne autoritetingą balansą. Perkrovus puslapį arba prisijungus iš naujo
neaiškios baigties pavedimas gali būti kartojamas rankiniu būdu su tuo pačiu
ID. Parametrai užrakinami iki patvirtintos sėkmės arba aiškaus atmetimo.
Jokių automatinių POST pakartojimų po transporto klaidos nėra.

Tik trade funkcijai leidžiamus adresus papildomai nustato TRADE_ALLOWED_ORIGINS;
esamas ALLOWED_ORIGINS išsaugomas. Vietinei aplinkai leistas localhost:5174.
Gyvas gateway režimas iki ir po šio CORS pakeitimo lieka verify_jwt=false;
funkcija privalomai tikrina Bearer per Supabase Auth /user. Diegiant būtina
sąmoningai išsaugoti gyvą režimą (senas config.toml įrašas vis dar true).

Patikra: node --test --experimental-test-isolation=none tests/trading-ui.test.mjs
tests/portfolio-ui.test.mjs supabase/functions/tests/trade.test.mjs (39 testai).
Build ir Trading.jsx lint praėjo. Gyvas OPTIONS vietiniam adresui: 204,
pašaliniam: 403, POST be vartotojo JWT: 401. Tikri finansiniai bandymai bendroje
DB nevykdyti; pirkimo/pardavimo ir pakartojimo scenarijai automatiniuose
testuose naudoja imituotus API atsakymus. SQL ši integracija nekeičia.
