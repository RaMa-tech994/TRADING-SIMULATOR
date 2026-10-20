import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../_shared/quotes.mjs';
import { createPortfolioHistoryHandler, historyRange } from '../_shared/portfolio-history-handler.mjs';
import { createChartBackend } from '../_shared/chart-rest.mjs';
const id = 'a0000000-0000-4000-8000-000000000001', requestId = '10000000-0000-4000-8000-000000000001';
const point = (extra = {}) => ({ captured_at: '2026-10-20T23:00:00Z', cash_balance: '9657.06', holdings_value: '342.94',
  portfolio_value: '10000.00', total_profit_loss: '0.00', valuation_details: {}, ...extra });
const result = (extra = {}) => ({ replayed: false, snapshot: { ...point(), id, request_id: requestId }, ...extra });
const history = points => ({ currency: 'USD', initial_balance: '10000.00', profit_loss_type: 'total_since_initial_balance', has_more: false, points });
function setup(overrides = {}) {
  const calls = [];
  const handle = createPortfolioHistoryHandler({ getUser: async () => ({ id, role: 'authenticated' }),
    list: async (...args) => { calls.push(['list', ...args]); return history([point()]); },
    capture: async (...args) => { calls.push(['capture', ...args]); return result(); },
    readPortfolio: async () => { calls.push(['read']); return { positions: [{ symbol: 'AAPL' }] }; },
    getQuote: async symbol => { calls.push(['quote', symbol]); return { symbol, cache_fresh: true, price_freshness: 'recent_daily', possibly_stale: false, stale: false, is_realtime: false }; },
    origins: ['http://localhost:5173'], ...overrides });
  return { handle, calls };
}
function request(method = 'GET', body = { request_id: requestId }, query = '', headers = {}) {
  return new Request('https://example.invalid/portfolio-history' + query, { method,
    headers: { authorization: 'Bearer user-test', origin: 'http://localhost:5173', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}
test('GET tik skaito savo istoriją; nei įrašymo, nei kainų API kvietimų', async () => {
  const { handle, calls } = setup(); const response = await handle(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).points[0].portfolio_value, '10000.00');
  assert.deepEqual(calls, [['list', 'user-test', { p_from: null, p_to: null, p_limit: 100 }]]);
});
test('Tuščia istorija lieka tuščia, praeities taškai nekuriami', async () => {
  const response = await setup({ list: async () => history([]) }).handle(request());
  assert.deepEqual((await response.json()).points, []);
});
test('GET laikotarpis ir limitas tiksliai perduodami SQL', () => {
  assert.deepEqual(historyRange(request('GET', null, '?from=2026-10-01T00:00:00Z&to=2026-10-20T23:59:59.999999Z&limit=5')),
    { p_from: '2026-10-01T00:00:00Z', p_to: '2026-10-20T23:59:59.999999Z', p_limit: 5 });
});
for (const query of ['?user_id=foreign', '?limit=0', '?limit=501', '?limit=1&limit=2', '?from=2026-02-30T00:00:00Z',
  '?from=2026-10-21T00:00:00Z&to=2026-10-20T00:00:00Z', '?from=2026-10-20']) {
  test('GET atmeta netinkamą užklausą: ' + query, async () => {
    const { handle, calls } = setup(); assert.equal((await handle(request('GET', null, query))).status, 400); assert.equal(calls.length, 0);
  });
}
test('POST įrašo tik aiškiai paprašytą dabartinį tašką', async () => {
  const { handle, calls } = setup(); const response = await handle(request('POST'));
  assert.equal(response.status, 201); assert.equal((await response.json()).success, true);
  assert.deepEqual(calls, [['capture', 'user-test', requestId]]);
});
test('Pakartotas ID grąžina ankstesnį tašką be kainų kvotos', async () => {
  const { handle, calls } = setup({ capture: async () => result({ replayed: true }) });
  const response = await handle(request('POST')); assert.equal(response.status, 200);
  assert.equal((await response.json()).replayed, true); assert.equal(calls.length, 0);
});
for (const body of [{ request_id: requestId, user_id: id }, { request_id: requestId, cash_balance: '1' },
  { request_id: requestId, captured_at: '2020-01-01' }, {}, { request_id: 'bad' }, null, []]) {
  test('POST atmeta kliento finansinius / datos duomenis arba blogą ID: ' + JSON.stringify(body), async () => {
    const { handle, calls } = setup(); assert.equal((await handle(request('POST', body))).status, 400); assert.equal(calls.length, 0);
  });
}
test('Nepilnas vertinimas atnaujina kainas ir tik kartą pakartoja tą patį ID', async () => {
  const ids = []; let captures = 0;
  const { handle, calls } = setup({ capture: async (_token, id) => {
    ids.push(id); if (++captures === 1) throw new ApiError(409, 'INCOMPLETE_VALUATION', 'Missing'); return result();
  } });
  assert.equal((await handle(request('POST'))).status, 201);
  assert.deepEqual(ids, [requestId, requestId]); assert.deepEqual(calls.map(x => x[0]), ['read', 'quote']);
});
test('Pasenusi kaina ar kvota neleidžia pakartoti įrašymo', async () => {
  for (const quota of [false, true]) {
    let captures = 0;
    const { handle } = setup({ capture: async () => { captures++; throw new ApiError(409, 'INCOMPLETE_VALUATION', 'Missing'); },
      getQuote: async () => { if (quota) throw new ApiError(429, 'QUOTE_LIMIT', 'Limitas'); return { symbol: 'AAPL', cache_fresh: true, stale: true }; } });
    assert.equal((await handle(request('POST'))).status, quota ? 429 : 409); assert.equal(captures, 1);
  }
});
test('Neaiški baigtis nekartojama automatiškai; atsakyme lieka request_id', async () => {
  let captures = 0;
  const { handle, calls } = setup({ capture: async () => { captures++; throw new ApiError(503, 'SNAPSHOT_STATUS_UNKNOWN', 'Neaišku'); } });
  const response = await handle(request('POST')); const data = await response.json();
  assert.equal(response.status, 503); assert.equal(captures, 1); assert.equal(calls.length, 0);
  assert.equal(data.error.request_id, requestId); assert.equal(data.error.retry_with_same_request_id, true);
});
test('Nėra trečio SQL bandymo, rate limit ir nežinomas kalendorius neatnaujina API', async () => {
  let captures = 0;
  const { handle } = setup({ capture: async () => { captures++; throw new ApiError(409, 'INCOMPLETE_VALUATION', 'Missing'); } });
  assert.equal((await handle(request('POST'))).status, 409); assert.equal(captures, 2);
  for (const code of ['SNAPSHOT_TOO_SOON', 'QUOTE_UNVERIFIED']) {
    const { handle, calls } = setup({ capture: async () => { throw new ApiError(429, code, 'Atmesta'); } });
    await handle(request('POST')); assert.equal(calls.length, 0);
  }
});
test('Neteisingos sumos ar ne tas request_id nelaikomi sėkme', async () => {
  const get = await setup({ list: async () => history([point({ total_profit_loss: '10.00' })]) }).handle(request());
  assert.equal(get.status, 503);
  const post = await setup({ capture: async () => result({ snapshot: { ...result().snapshot, request_id: id } }) }).handle(request('POST'));
  assert.equal((await post.json()).error.code, 'SNAPSHOT_STATUS_UNKNOWN');
});
test('Autorizacija, CORS, metodai ir POST query apsauga', async () => {
  for (const user of [null, { id, role: 'service_role' }, { id: 'bad', role: 'authenticated' }]) {
    const { handle, calls } = setup({ getUser: async () => user }); assert.equal((await handle(request('POST'))).status, 401); assert.equal(calls.length, 0);
  }
  assert.equal((await setup().handle(request('GET', null, '', { authorization: '' }))).status, 401);
  assert.equal((await setup().handle(request('DELETE'))).status, 405);
  assert.equal((await setup().handle(request('OPTIONS'))).status, 204);
  assert.equal((await setup().handle(request('GET', null, '', { origin: 'https://forbidden.invalid' }))).status, 403);
  assert.equal((await setup().handle(request('POST', { request_id: requestId }, '?user_id=other'))).status, 400);
  assert.equal((await setup().handle(request('POST', { request_id: requestId }, '', { 'Content-Type': 'text/plain' }))).status, 415);
});
test('REST klaidos saugios, įrašymo transporto klaida žymima neaiškia', async () => {
  const api = createChartBackend({ url: 'https://example.invalid', publicKey: 'public-test', fetcher: async () => { throw Error('secret'); } });
  await assert.rejects(api.capture('user-test', requestId), e => e.code === 'SNAPSHOT_STATUS_UNKNOWN' && !e.message.includes('secret'));
  for (const [code, message, expected] of [['P0001', 'SNAPSHOT_TOO_SOON', 'SNAPSHOT_TOO_SOON'],
    ['P0001', 'INCOMPLETE_VALUATION', 'INCOMPLETE_VALUATION'], ['40P01', 'secret', 'SNAPSHOT_RETRY'], ['42501', 'secret', 'HISTORY_NOT_CONFIGURED']]) {
    const client = createChartBackend({ url: 'https://example.invalid', publicKey: 'public-test', fetcher: async () => Response.json({ code, message }, { status: 400 }) });
    await assert.rejects(client.capture('user-test', requestId), e => e.code === expected && !e.message.includes('secret'));
  }
});
