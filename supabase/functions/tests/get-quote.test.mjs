import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../_shared/handler.mjs';
import { fetchQuote, validateQuote, validateSymbol } from '../_shared/quotes.mjs';
import { createBackend } from '../_shared/supabase-rest.mjs';
import { describeQuote, expectedTradingDate } from '../_shared/freshness.mjs';

const now = () => new Date('2026-10-19T12:00:00Z');
const quote = { symbol: 'IBM', price: '240.120000', trading_date: '2026-10-16',
  fetched_at: '2026-10-19T10:00:00Z' };
const providerBody = { 'Global Quote': {
  '01. symbol': 'IBM', '05. price': '240.1200', '07. latest trading day': '2026-10-16',
} };
const req = (symbol = 'IBM', options = {}) => new Request(
  'https://example.test/get-quote?symbol=' + symbol,
  { headers: { authorization: 'Bearer test-user', origin: 'http://localhost:5173' }, ...options });
function setup(overrides = {}) {
  const calls = [];
  const handler = createHandler({
    authenticate: async () => true,
    store: {
      reserve: async () => ({ action: 'fetch', lease: 'lease-1' }),
      finish: async (...args) => { calls.push(args); },
    },
    apiKey: 'server-secret-test',
    origins: ['http://localhost:5173'],
    fetcher: async () => Response.json(providerBody),
    now,
    ...overrides,
  });
  return { handler, calls };
}

test('simbolis normalizuojamas; neleistini simboliai atmetami', () => {
  assert.equal(validateSymbol(' ibm '), 'IBM');
  for (const symbol of ['IBM&apikey=bad', '../AAPL', 'FAKE', '', null]) {
    assert.throws(() => validateSymbol(symbol));
  }
});

test('tikrinama kaina, tikra data, simbolis ir senumas', () => {
  for (const change of [
    { price: 'NaN' }, { price: '-1' }, { price: '0' }, { price: 'Infinity' },
    { price: '1e3' }, { price: '1.1234567' }, { symbol: 'AAPL' },
    { trading_date: '2026-02-30' }, { trading_date: '2026-10-20' },
    { trading_date: '2026-10-01' },
  ]) assert.throws(() => validateQuote({ ...quote, ...change }, 'IBM', now()));
  assert.equal(validateQuote(quote, 'IBM', now()).data_type, 'end_of_day');
});

test('sėkmė: dienos kaina, šaltinis, data; raktas negrąžinamas', async () => {
  const { handler, calls } = setup();
  const response = await handler(req());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.price, '240.1200');
  assert.equal(body.trading_date, '2026-10-16');
  assert.equal(body.source, 'Alpha Vantage');
  assert.equal(body.data_type, 'end_of_day');
  assert.equal(body.cached, false);
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(body).includes('server-secret-test'));
});

test('be prisijungimo DB ir tiekėjas nekviečiami', async () => {
  const { handler } = setup({ authenticate: async () => false,
    store: { reserve: () => { throw new Error('Negalima kviesti'); } },
    fetcher: () => { throw new Error('Negalima kviesti'); } });
  assert.equal((await handler(req())).status, 401);
  assert.equal((await handler(req('IBM', { headers: {} }))).status, 401);
});

test('talpyklos rezultatas nesunaudoja išorinių užklausų', async () => {
  const { handler } = setup({
    store: { reserve: async () => ({ action: 'cache', quote }) },
    fetcher: () => { throw new Error('Negalima kviesti'); },
  });
  const body = await (await handler(req())).json();
  assert.equal(body.cached, true);
  assert.equal(body.stale, false);
});

test('kvota ir vienalaikio atnaujinimo rezervacija stabdo išorinį kvietimą', async () => {
  for (const action of ['quota', 'throttled', 'busy']) {
    const { handler } = setup({
      store: { reserve: async () => ({ action }) },
      fetcher: () => { throw new Error('Negalima kviesti'); },
    });
    assert.equal((await handler(req())).status, action === 'busy' ? 503 : 429);
  }
});

test('HTTP 200 limito pranešimas nėra laikomas kaina; rezervacija atlaisvinama', async () => {
  const { handler, calls } = setup({
    fetcher: async () => Response.json({ Information: 'API rate limit reached' }),
  });
  const response = await handler(req());
  assert.equal(response.status, 429);
  assert.equal(calls[0][2], null);
  assert.equal(calls[0][3], true);
});

test('tiekėjo HTTP, JSON ir tinklo klaidos saugiai apdorojamos', async () => {
  for (const fetcher of [
    async () => new Response('failure', { status: 500 }),
    async () => new Response('not-json'),
    async () => { throw new Error('https://provider.test?apikey=SECRET'); },
    async () => Response.json({ 'Global Quote': {} }),
    async () => Response.json({ 'Error Message': 'SECRET' }),
    async () => Response.json({ Information: 'premium subscription required SECRET' }),
  ]) {
    await assert.rejects(fetchQuote('IBM', 'SECRET', fetcher, now()), error =>
      error.status === 502 && !error.message.includes('SECRET'));
  }
});

test('klaidos atveju sena tinkama kaina aiškiai pažymima; per sena negrąžinama', async () => {
  for (const tradingDate of ['2026-10-16', '2026-10-01']) {
    const { handler } = setup({
      store: {
        reserve: async () => ({ action: 'fetch', lease: 'x',
          quote: { ...quote, trading_date: tradingDate } }),
        finish: async () => {},
      },
      fetcher: async () => { throw new Error('timeout'); },
    });
    const response = await handler(req());
    assert.equal(response.status, tradingDate === '2026-10-16' ? 200 : 502);
    if (response.status === 200) assert.equal((await response.json()).stale, true);
  }
});

test('CORS, metodai, trūkstamas raktas ir pasikartojantys parametrai', async () => {
  const { handler } = setup();
  assert.equal((await handler(req('IBM', { method: 'OPTIONS' }))).status, 204);
  assert.equal((await handler(req('IBM', { method: 'POST' }))).status, 405);
  assert.equal((await handler(req('IBM', { headers: { origin: 'https://evil.test' } }))).status, 403);
  assert.equal((await handler(req('IBM&symbol=AAPL'))).status, 400);
  assert.equal((await handler(req('IBM&apikey=anything'))).status, 400);
  assert.equal((await setup({ apiKey: '' }).handler(req())).status, 503);
});

test('Supabase REST tikrina vartotoją ir siunčia tik rezervuotą RPC', async () => {
  const seen = [];
  const backend = createBackend({
    url: 'https://project.supabase.co', serviceKey: 'server-key',
    fetcher: async (url, options) => {
      seen.push({ url, options });
      return Response.json(url.endsWith('/auth/v1/user')
        ? { id: '11111111-1111-4111-8111-111111111111' } : { action: 'quota' });
    },
  });
  assert.equal(await backend.authenticate('user-jwt'), true);
  await backend.store.reserve('IBM');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer user-jwt');
  assert.equal(seen[1].options.headers.Authorization, 'Bearer server-key');
  assert.deepEqual(JSON.parse(seen[1].options.body), { p_symbol: 'IBM' });
});

test('netikėta DB klaida neatskleidžia slapto teksto', async () => {
  const { handler } = setup({ store: { reserve: async () => { throw new Error('SECRET'); } } });
  const response = await handler(req());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('SECRET'));
});
const calendarCases = [
  ['šeštadienį tikimasi penktadienio', '2026-10-17T16:00:00Z', '2026-10-16'],
  ['sekmadienį tikimasi penktadienio', '2026-10-18T16:00:00Z', '2026-10-16'],
  ['pirmadienį prieš sesiją tikimasi penktadienio', '2026-10-19T12:00:00Z', '2026-10-16'],
  ['vasaros laiku iki paskelbimo rezervo', '2026-10-19T21:59:00Z', '2026-10-16'],
  ['vasaros laiku po paskelbimo rezervo', '2026-10-19T22:00:00Z', '2026-10-19'],
  ['žiemos laiku iki paskelbimo rezervo', '2026-11-02T22:59:00Z', '2026-10-30'],
  ['žiemos laiku po paskelbimo rezervo', '2026-11-02T23:00:00Z', '2026-11-02'],
  ['Didįjį penktadienį tikimasi ketvirtadienio', '2026-04-03T22:00:00Z', '2026-04-02'],
  ['pirmadienio šventė nepakeičia paskutinės sesijos', '2026-09-07T22:00:00Z', '2026-09-04'],
  ['po Kalėdų savaitgalio tikimasi gruodžio 24', '2026-12-28T12:00:00Z', '2026-12-24'],
  ['Padėkos dieną tikimasi trečiadienio', '2026-11-26T23:00:00Z', '2026-11-25'],
  ['sutrumpintą dieną iki paskelbimo rezervo', '2026-11-27T19:59:00Z', '2026-11-25'],
  ['sutrumpintą dieną po paskelbimo rezervo', '2026-11-27T20:00:00Z', '2026-11-27'],
  ['UTC data nepakeičia Niujorko prekybos datos', '2026-10-20T01:00:00Z', '2026-10-19'],
  ['2027 m. liepos 5 d. yra nedarbo diena', '2027-07-05T22:00:00Z', '2027-07-02'],
  ['2028 m. sausio 1 d. šventė neperkeliama į gruodžio 31', '2028-01-01T18:00:00Z', '2027-12-31'],
  ['2028 m. liepos 3 d. sutrumpinta sesija', '2028-07-03T19:00:00Z', '2028-07-03'],
  ['už kalendoriaus ribų aktualumas netvirtinamas', '2029-01-03T23:00:00Z', null],
  ['nežinoma ankstesnių metų sesija neatspėjama', '2026-01-01T18:00:00Z', null],
];
for (const [name, time, expected] of calendarCases) {
  test(name, () => assert.equal(expectedTradingDate(new Date(time)), expected));
}

test('ką tik gauta 7 dienų senumo kaina nėra šviežia', async () => {
  const current = () => new Date('2026-10-19T23:00:00Z');
  const { handler } = setup({
    now: current,
    fetcher: async () => Response.json({ 'Global Quote': {
      ...providerBody['Global Quote'], '07. latest trading day': '2026-10-12',
    } }),
  });
  const response = await handler(req());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.trading_date, '2026-10-12');
  assert.equal(body.cache_fresh, true);
  assert.equal(body.cached, false);
  assert.equal(body.possibly_stale, true);
  assert.equal(body.stale, true);
  assert.equal(body.price_freshness, 'outdated_daily');
  assert.equal(body.is_realtime, false);
  assert.match(body.warning, /ne realaus laiko/);
});

test('techniškai galiojanti talpykla nepaslepia senos prekybos datos ir nekviečia API', async () => {
  let externalCalls = 0;
  const { handler } = setup({
    now: () => new Date('2026-10-19T23:00:00Z'),
    store: { reserve: async () => ({ action: 'cache',
      quote: { ...quote, trading_date: '2026-10-12' } }) },
    fetcher: async () => { externalCalls++; throw new Error('Negalima'); },
  });
  const body = await (await handler(req())).json();
  assert.equal(body.cache_fresh, true);
  assert.equal(body.price_freshness, 'outdated_daily');
  assert.equal(body.possibly_stale, true);
  assert.equal(body.trading_date, '2026-10-12');
  assert.equal(externalCalls, 0);
});

test('savaitgalio ir šventinės dienos paskutinė sesija yra dienos, ne realaus laiko kaina', async () => {
  for (const [time, date] of [
    ['2026-10-18T16:00:00Z', '2026-10-16'],
    ['2026-09-07T22:00:00Z', '2026-09-04'],
    ['2026-12-28T12:00:00Z', '2026-12-24'],
  ]) {
    const { handler } = setup({
      now: () => new Date(time),
      store: { reserve: async () => ({ action: 'cache',
        quote: { ...quote, trading_date: date, fetched_at: time } }) },
      fetcher: async () => { throw new Error('Negalima kviesti'); },
    });
    const body = await (await handler(req())).json();
    assert.equal(body.trading_date, date);
    assert.equal(body.expected_trading_date, date);
    assert.equal(body.price_freshness, 'recent_daily');
    assert.equal(body.possibly_stale, false);
    assert.equal(body.is_realtime, false);
    assert.equal(body.data_type, 'end_of_day');
    assert.match(body.warning, /ne realaus laiko/);
  }
});

test('talpyklos 24 valandų riba nepriklauso nuo tinkamos paskutinės prekybos datos', () => {
  const current = new Date('2026-10-18T16:00:00Z');
  for (const [fetchedAt, fresh] of [
    ['2026-10-17T16:00:00.001Z', true],
    ['2026-10-17T16:00:00.000Z', false],
    ['2026-10-17T15:59:59.999Z', false],
    ['2026-10-19T16:00:00.000Z', false],
    ['netinkamas-laikas', false],
  ]) {
    const body = describeQuote(quote, { fetchedAt, cached: true, now: current });
    assert.equal(body.cache_fresh, fresh);
    assert.equal(body.price_freshness, 'recent_daily');
    assert.equal(body.possibly_stale, false);
    assert.equal(body.stale, !fresh);
  }
});

test('nepalaikomais metais net ką tik gauta kaina žymima nepatvirtinta', async () => {
  const { handler } = setup({
    now: () => new Date('2029-01-03T23:00:00Z'),
    fetcher: async () => Response.json({ 'Global Quote': {
      ...providerBody['Global Quote'], '07. latest trading day': '2029-01-03',
    } }),
  });
  const body = await (await handler(req())).json();
  assert.equal(body.price_freshness, 'unverified');
  assert.equal(body.expected_trading_date, null);
  assert.equal(body.possibly_stale, true);
  assert.equal(body.is_realtime, false);
});

test('kvota išsaugoma ir pasenusios kainos atveju: nekviečiama API', async () => {
  for (const action of ['quota', 'throttled', 'busy']) {
    let externalCalls = 0;
    const { handler } = setup({
      now: () => new Date('2026-10-19T23:00:00Z'),
      store: { reserve: async () => ({ action,
        quote: { ...quote, trading_date: '2026-10-12' } }) },
      fetcher: async () => { externalCalls++; throw new Error('Negalima'); },
    });
    const response = await handler(req());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.possibly_stale, true);
    assert.equal(body.stale, true);
    assert.equal(body.trading_date, '2026-10-12');
    assert.equal(externalCalls, 0);
  }
});

test('tiekėjo ankstesnė data neperrašo naujesnės talpyklos kainos', async () => {
  const writes = [];
  const { handler } = setup({
    store: {
      reserve: async () => ({ action: 'fetch', lease: 'x', quote }),
      finish: async (...args) => writes.push(args),
    },
    fetcher: async () => Response.json({ 'Global Quote': {
      ...providerBody['Global Quote'], '07. latest trading day': '2026-10-15',
    } }),
  });
  const body = await (await handler(req())).json();
  assert.equal(body.trading_date, '2026-10-16');
  assert.equal(body.cached, true);
  assert.equal(body.possibly_stale, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2], null);
});

test('neįmanoma nedarbo dienos prekybos data nelaikoma patvirtinta', () => {
  const body = describeQuote({ ...quote, trading_date: '2026-10-17' }, {
    fetchedAt: '2026-10-18T15:00:00Z', cached: true, now: new Date('2026-10-18T16:00:00Z'),
  });
  assert.equal(body.price_freshness, 'unverified');
  assert.equal(body.possibly_stale, true);
});