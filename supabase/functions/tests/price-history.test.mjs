import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../_shared/quotes.mjs';
import { validatePricePoints, fetchPriceHistory, createPriceHistoryService } from '../_shared/price-history.mjs';
import { createPriceHistoryHandler } from '../_shared/price-history-handler.mjs';
import { createChartBackend } from '../_shared/chart-rest.mjs';
const date = new Date('2026-10-20T23:00:00Z'), now = () => date;
const id = 'a0000000-0000-4000-8000-000000000001';
const points = [{ date: '2026-10-19', close: '340.125000' }, { date: '2026-10-20', close: '342.940000' }];
const history = (extra = {}) => ({ symbol: 'AAPL', points, latest_trading_date: '2026-10-20', fetched_at: date.toISOString(), ...extra });
const provider = () => ({ 'Meta Data': { '2. Symbol': 'AAPL' }, 'Time Series (Daily)': {
  '2026-10-20': { '4. close': '342.940000' }, '2026-10-19': { '4. close': '340.125000' },
} });
test('TIME_SERIES_DAILY compact: serverio raktas, tikros datos, kainos eilutėmis', async () => {
  const result = await fetchPriceHistory('AAPL', 'test-provider-key', async url => {
    assert.equal(url.origin, 'https://www.alphavantage.co');
    assert.equal(url.searchParams.get('function'), 'TIME_SERIES_DAILY');
    assert.equal(url.searchParams.get('outputsize'), 'compact');
    assert.equal(url.searchParams.get('apikey'), 'test-provider-key');
    return Response.json(provider());
  }, date);
  assert.deepEqual(result, points);
});
for (const [name, bad] of Object.entries({ empty: [], duplicates: [points[0], points[0]], reversed: [...points].reverse(),
  future: [{ date: '2026-10-21', close: '1' }], invalidDate: [{ date: '2026-02-30', close: '1' }],
  zero: [{ date: '2026-10-20', close: '0' }], negative: [{ date: '2026-10-20', close: '-1' }],
  numeric: [{ date: '2026-10-20', close: 1 }], nan: [{ date: '2026-10-20', close: 'NaN' }],
  precision: [{ date: '2026-10-20', close: '1.1234567' }], tooMany: Array(101).fill(points[0]) })) {
  test('Netinkama istorija atmetama: ' + name, () => assert.throws(() => validatePricePoints(bad, date)));
}
test('Senesni nei 7 dienų tikri istorijos taškai leidžiami', () => {
  assert.equal(validatePricePoints([{ date: '2026-01-02', close: '123.123456' }], date).length, 1);
});
test('Provider HTTP, JSON, limito ir simbolio klaidos nerodo raktų', async () => {
  for (const make of [() => new Response('', { status: 429 }), () => Response.json({ Note: 'secret' }),
    () => Response.json({ Information: '25 requests secret' }), () => Response.json({ Information: 'premium secret' }),
    () => new Response('secret', { status: 500 }), () => new Response('not json'),
    () => Response.json({ ...provider(), 'Meta Data': { '2. Symbol': 'TSLA' } })]) {
    await assert.rejects(fetchPriceHistory('AAPL', 'secret', async () => make(), date), error => !error.message.includes('secret'));
  }
});
test('Talpykla: be išorinio kvietimo, techninis galiojimas atskirtas nuo prekybos datos', async () => {
  const get = createPriceHistoryService({ apiKey: 'test', now,
    store: { reserve: async () => ({ action: 'cache', history: history({ points: [points[0]], latest_trading_date: points[0].date }) }) },
    fetcher: () => assert.fail('API neturi būti kviečiama') });
  const result = await get(' aapl ');
  assert.equal(result.cache_fresh, true); assert.equal(result.price_freshness, 'outdated_daily');
  assert.equal(result.stale, true); assert.equal(result.is_realtime, false);
});
for (const action of ['quota', 'throttled', 'busy']) {
  test('Bendra kvota ir rezervacija neapeinama: ' + action, async () => {
    const get = createPriceHistoryService({ apiKey: 'test', now,
      store: { reserve: async () => ({ action }) }, fetcher: () => assert.fail('API negalima') });
    await assert.rejects(get('AAPL'), error => error.code === (action === 'busy' ? 'REFRESH_IN_PROGRESS' : 'HISTORY_LIMIT'));
  });
}
test('Limito atsarginė istorija tikra, bet aiškiai pasenusi', async () => {
  const get = createPriceHistoryService({ apiKey: 'test', now,
    store: { reserve: async () => ({ action: 'quota', history: history({ fetched_at: '2026-10-18T00:00:00Z' }) }) } });
  const result = await get('AAPL'); assert.equal(result.possibly_stale, true); assert.equal(result.cache_fresh, false);
});
test('Rezervuota užklausa išsaugo istoriją, raktas atsakyme nepatenka', async () => {
  const finishes = [];
  const get = createPriceHistoryService({ apiKey: 'secret', now, fetcher: async () => Response.json(provider()),
    store: { reserve: async () => ({ action: 'fetch', lease: 'lease' }), finish: async (...args) => finishes.push(args) } });
  const result = await get('AAPL'); assert.equal(result.cached, false);
  assert.deepEqual(finishes[0], ['AAPL', 'lease', points]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('Tiekėjo limitas atlaisvina rezervaciją su p_rate_limited, automatinio fetch kartojimo nėra', async () => {
  const finishes = []; let calls = 0;
  const get = createPriceHistoryService({ apiKey: 'test', now, fetcher: async () => { calls++; return Response.json({ Note: 'limit' }); },
    store: { reserve: async () => ({ action: 'fetch', lease: 'lease' }), finish: async (...args) => finishes.push(args) } });
  await assert.rejects(get('AAPL')); assert.equal(calls, 1); assert.deepEqual(finishes[0], ['AAPL', 'lease', null, true]);
});
test('Ankstesnė tiekėjo data neperrašo naujesnės istorijos', async () => {
  const finishes = [];
  const older = provider(); delete older['Time Series (Daily)']['2026-10-20'];
  const get = createPriceHistoryService({ apiKey: 'test', now, fetcher: async () => Response.json(older),
    store: { reserve: async () => ({ action: 'fetch', lease: 'lease', history: history() }), finish: async (...args) => finishes.push(args) } });
  const result = await get('AAPL'); assert.equal(result.latest_trading_date, '2026-10-20'); assert.equal(result.stale, true);
  assert.deepEqual(finishes[0], ['AAPL', 'lease', null, false]);
});
const req = (query = '?symbol=AAPL', headers = {}, method = 'GET') => new Request('https://example.invalid/price-history' + query,
  { method, headers: { origin: 'http://localhost:5173', ...headers } });
const handler = overrides => createPriceHistoryHandler({ getUser: async () => ({ id, role: 'authenticated' }),
  getHistory: async () => history(), origins: ['http://localhost:5173'], ...overrides });
test('HTTP JWT, CORS, metodai ir griežti query parametrai', async () => {
  assert.equal((await handler({ getHistory: () => assert.fail() })(req())).status, 401);
  assert.equal((await handler({ getUser: async () => null, getHistory: () => assert.fail() })(req('?symbol=AAPL', { authorization: 'Bearer bad' }))).status, 401);
  assert.equal((await handler({})(req('', {}, 'OPTIONS'))).status, 204);
  assert.equal((await handler({})(req('', {}, 'POST'))).status, 405);
  assert.equal((await handler({})(req('?symbol=AAPL', { origin: 'https://forbidden.invalid' }))).status, 403);
  for (const query of ['', '?symbol=AAPL&symbol=MSFT', '?symbol=AAPL&user_id=other']) {
    assert.equal((await handler({})(req(query, { authorization: 'Bearer user' }))).status, 400);
  }
  const result = await handler({})(req('?symbol=AAPL', { authorization: 'Bearer user' }));
  assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'no-store');
});
test('Kainų RPC tik service_role; finansinis skaitymas tik vartotojo JWT', async () => {
  const calls = [];
  const api = createChartBackend({ url: 'https://example.invalid', publicKey: 'public-test', serviceKey: 'admin-test',
    fetcher: async (url, options) => { calls.push({ url, options }); return Response.json({ action: 'cache' }); } });
  await api.priceStore.reserve('AAPL'); await api.priceStore.finish('AAPL', 'lease', points);
  await api.list('user-test', { p_from: null, p_to: null, p_limit: 100 }); await api.capture('user-test', id);
  for (const call of calls.slice(0, 2)) assert.equal(call.options.headers.Authorization, 'Bearer admin-test');
  for (const call of calls.slice(2)) {
    assert.equal(call.options.headers.Authorization, 'Bearer user-test'); assert.equal(call.options.headers.apikey, 'public-test');
  }
  assert.deepEqual(JSON.parse(calls[3].options.body), { p_request_id: id });
  assert.ok(calls[0].url.endsWith('/av_reserve_price_history'));
});
test('Nenumatyta klaida HTTP atsakyme neatskleidžiama', async () => {
  const response = await handler({ getHistory: () => { throw new ApiError(429, 'HISTORY_LIMIT', 'Limitas'); } })(req('?symbol=AAPL', { authorization: 'Bearer user' }));
  assert.equal(response.status, 429);
  const hidden = await handler({ getUser: () => { throw Error('secret'); } })(req('?symbol=AAPL', { authorization: 'Bearer user' }));
  assert.equal((await hidden.text()).includes('secret'), false);
});
