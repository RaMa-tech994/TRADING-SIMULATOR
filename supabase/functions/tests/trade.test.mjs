import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../_shared/quotes.mjs';
import { createTradeHandler } from '../_shared/trade-handler.mjs';
import { createTradeExecutor, parseTradeJson } from '../_shared/trade-rest.mjs';
import { createBackend } from '../_shared/supabase-rest.mjs';
import { validateTrade } from '../_shared/trade-validation.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const TX = '33333333-3333-4333-8333-333333333333';
const order = { symbol: 'IBM', side: 'BUY', quantity: 2, request_id: ID };
const quote = { symbol: 'IBM', cache_fresh: true, price_freshness: 'recent_daily',
  possibly_stale: false, stale: false, is_realtime: false };
const result = (changes = {}) => ({
  replayed: false,
  transaction: {
    id: TX, user_id: USER, request_id: ID, symbol: 'IBM', side: 'buy', quantity: '2',
    price: '100.010000', quote_price: '100.005000', total_amount: '200.02',
    quote_trading_date: '2026-10-16', quote_fetched_at: '2026-10-19T10:00:00Z',
    quote_source: 'Alpha Vantage', quote_at: null, executed_at: '2026-10-19T12:00:00Z',
    ...changes,
  },
});
function request(body = order, options = {}) {
  return new Request('https://example.test/trade', {
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json',
      origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
    ...options,
  });
}
function setup(overrides = {}) {
  const calls = { trade: [], quote: [], auth: [] };
  const handler = createTradeHandler({
    getUser: async token => { calls.auth.push(token); return { id: USER, role: 'authenticated' }; },
    executeTrade: async (...args) => { calls.trade.push(args); return result(); },
    getQuote: async symbol => { calls.quote.push(symbol); return quote; },
    origins: ['http://localhost:5173'],
    ...overrides,
  });
  return { handler, calls };
}

test('BUY normalizuojamas; leidžiami tik keturi pavedimo laukai', () => {
  assert.deepEqual(validateTrade({ ...order, symbol: ' ibm ' }), {
    ...order, symbol: 'IBM', side: 'buy',
  });
  for (const body of [
    { ...order, price: 0.01 }, { ...order, user_id: USER }, { ...order, total_amount: 1 },
    { ...order, side: 'delete' }, { ...order, quantity: '2' }, { ...order, quantity: 0 },
    { ...order, quantity: -1 }, { ...order, quantity: 1.5 },
    { ...order, quantity: 2147483648 }, { ...order, request_id: 'anything' },
    { ...order, symbol: 'IBM&price=1' }, { ...order, symbol: 'FAKE' }, [], null,
  ]) assert.throws(() => validateTrade(body));
});

test('BUY naudoja vartotojo JWT ir SQL rezultatą, kainos JS neapvalina', async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.transaction.price, '100.010000');
  assert.equal(body.transaction.quote_price, '100.005000');
  assert.equal(body.transaction.total_amount, '200.02');
  assert.equal(body.is_realtime, false);
  assert.equal(body.data_type, 'end_of_day');
  assert.equal(calls.trade[0][0], 'user-jwt');
  assert.deepEqual(calls.trade[0][1], { ...order, side: 'buy' });
  assert.equal(calls.quote.length, 0);
});

test('SELL sėkmė', async () => {
  const { handler } = setup({ executeTrade: async () => result({ side: 'sell' }) });
  assert.equal((await handler(request({ ...order, side: 'SELL' }))).status, 201);
});

test('be JWT ar su atmestu JWT nepasiekiami nei SQL, nei API', async () => {
  const { handler, calls } = setup({ getUser: async () => null });
  assert.equal((await handler(request())).status, 401);
  assert.equal((await handler(request(order, { headers: { 'content-type': 'application/json' } }))).status, 401);
  assert.equal(calls.trade.length, 0);
  assert.equal(calls.quote.length, 0);
});

test('tikras Auth adapteris atmeta 401/403 ir netinkamą vartotojo atsakymą', async () => {
  for (const response of [
    Response.json({ message: 'expired' }, { status: 401 }),
    Response.json({ message: 'forbidden' }, { status: 403 }),
    Response.json({ id: 'bad' }), Response.json(null),
  ]) {
    const backend = createBackend({ url: 'https://project.test', publicKey: 'public-test',
      fetcher: async () => response });
    const { handler, calls } = setup({ getUser: backend.getUser });
    assert.equal((await handler(request())).status, 401);
    assert.equal(calls.trade.length, 0);
  }
});

test('service_role ir nepilna tapatybė neleidžiami', async () => {
  for (const user of [{ id: USER, role: 'service_role' }, { id: USER }, { role: 'authenticated' }]) {
    const { handler } = setup({ getUser: async () => user });
    assert.equal((await handler(request())).status, 401);
  }
});

for (const [code, message] of [
  ['INSUFFICIENT_FUNDS', 'Nepakanka virtualių pinigų.'],
  ['INSUFFICIENT_SHARES', 'Nepakanka turimų akcijų.'],
]) test(code + ' grąžina aiškią klaidą ir neatnaujina kainų', async () => {
  const { handler, calls } = setup({ executeTrade: async () => { throw new ApiError(409, code, message); } });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, code);
  assert.equal(calls.quote.length, 0);
});

test('pakartotas request_id grąžina tą patį sandorį be kainų kvotos naudojimo', async () => {
  let committed = false;
  let executions = 0;
  const { handler, calls } = setup({
    executeTrade: async () => {
      const replayed = committed;
      if (!committed) { committed = true; executions++; }
      return { ...result(), replayed };
    },
  });
  const responses = await Promise.all([handler(request()), handler(request())]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  assert.equal(executions, 1);
  assert.equal(calls.quote.length, 0);
  for (const response of responses) assert.equal((await response.json()).transaction.id, TX);
});

test('tas pats request_id su kitais parametrais grąžina konfliktą', async () => {
  const { handler, calls } = setup({
    executeTrade: async () => { throw new ApiError(409, 'REQUEST_ID_CONFLICT', 'Konfliktas.'); },
  });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'REQUEST_ID_CONFLICT');
  assert.equal(calls.quote.length, 0);
});

for (const code of ['QUOTE_UNAVAILABLE', 'QUOTE_CACHE_EXPIRED', 'QUOTE_STALE']) {
  test(code + ': kaina atnaujinama ir tas pats pavedimas bandomas tik kartą', async () => {
    let executions = 0;
    const seen = [];
    const { handler, calls } = setup({ executeTrade: async (token, value) => {
      seen.push([token, value]);
      if (++executions === 1) throw new ApiError(409, code, 'Kainos reikia.');
      return result();
    } });
    assert.equal((await handler(request())).status, 201);
    assert.equal(executions, 2);
    assert.equal(calls.quote.length, 1);
    assert.deepEqual(seen[0], seen[1]);
    assert.ok(!Object.hasOwn(seen[1][1], 'price'));
  });
}

test('pasenusi, atsarginė ir nepatvirtinta kaina neleidžia antro SQL kvietimo', async () => {
  for (const changed of [
    { cache_fresh: false }, { price_freshness: 'outdated_daily' },
    { price_freshness: 'unverified' }, { possibly_stale: true }, { stale: true },
    { is_realtime: true }, { symbol: 'AAPL' },
  ]) {
    let attempts = 0;
    const { handler } = setup({
      executeTrade: async () => { attempts++; throw new ApiError(409, 'QUOTE_STALE', 'Kaina sena.'); },
      getQuote: async () => ({ ...quote, ...changed }),
    });
    assert.ok((await handler(request())).status >= 400);
    assert.equal(attempts, 1);
  }
});

test('API kvota nepereinama dėl prekybos užklausos', async () => {
  let attempts = 0;
  const { handler } = setup({
    executeTrade: async () => { attempts++; throw new ApiError(503, 'QUOTE_UNAVAILABLE', 'Nėra kainos.'); },
    getQuote: async () => { throw new ApiError(429, 'QUOTE_LIMIT', 'Kvota.'); },
  });
  assert.equal((await handler(request())).status, 429);
  assert.equal(attempts, 1);
});

test('pakitusi kaina ar pasibaigęs jos terminas antrame RPC nesukelia trečio bandymo', async () => {
  let attempts = 0;
  const { handler } = setup({ executeTrade: async () => {
    attempts++;
    throw new ApiError(409, 'QUOTE_STALE', 'Kaina pasikeitė.');
  } });
  assert.equal((await handler(request())).status, 409);
  assert.equal(attempts, 2);
});

test('tinklo klaida gali reikšti įvykdytą sandorį: automatinio kartojimo nėra', async () => {
  let calls = 0;
  const executeTrade = createTradeExecutor({
    url: 'https://project.test', publicKey: 'public-test',
    fetcher: async () => { calls++; throw new Error('SECRET_KEY_OR_TOKEN'); },
  });
  const { handler, calls: seen } = setup({ executeTrade });
  const response = await handler(request());
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'TRADE_STATUS_UNKNOWN');
  assert.equal(body.error.request_id, ID);
  assert.equal(body.error.retry_with_same_request_id, true);
  assert.equal(calls, 1);
  assert.equal(seen.quote.length, 0);
  assert.ok(!JSON.stringify(body).includes('SECRET_KEY_OR_TOKEN'));
});

test('finansinis REST RPC gauna tik vartotojo Bearer ir tris SQL parametrus', async () => {
  for (const side of ['buy', 'sell']) {
    let seen;
    const execute = createTradeExecutor({
      url: 'https://project.test', publicKey: 'public-test',
      fetcher: async (url, options) => { seen = { url, options }; return Response.json(result({ side })); },
    });
    await execute('user-jwt', { ...order, side });
    assert.ok(seen.url.endsWith(side === 'buy' ? '/buy_stock' : '/sell_stock'));
    assert.equal(seen.options.headers.Authorization, 'Bearer user-jwt');
    assert.equal(seen.options.headers.apikey, 'public-test');
    assert.deepEqual(JSON.parse(seen.options.body), {
      p_request_id: ID, p_symbol: 'IBM', p_quantity: 2,
    });
  }
});

test('SQL pinigų JSON išsaugo centus virš saugaus JS sveikojo skaičiaus ribos', () => {
  const parsed = parseTradeJson('{"transaction":{"total_amount":9999999999999999.99,"price":100.010000,"quantity":2,"quote_source":"123 \\"kaina\\""},"replayed":false}');
  assert.equal(parsed.transaction.total_amount, '9999999999999999.99');
  assert.equal(parsed.transaction.price, '100.010000');
  assert.equal(parsed.transaction.quantity, '2');
  assert.equal(parsed.transaction.quote_source, '123 "kaina"');
  assert.equal(parsed.replayed, false);
});

test('SQL verslo klaidos saugiai susiejamos su HTTP', async () => {
  for (const [sqlCode, sqlMessage, expectedStatus, expectedCode] of [
    ['P0001', 'INSUFFICIENT_FUNDS', 409, 'INSUFFICIENT_FUNDS'],
    ['P0001', 'INSUFFICIENT_SHARES', 409, 'INSUFFICIENT_SHARES'],
    ['P0001', 'REQUEST_ID_CONFLICT', 409, 'REQUEST_ID_CONFLICT'],
    ['22003', 'INVALID_AMOUNT', 422, 'INVALID_AMOUNT'],
    ['28000', 'UNAUTHORIZED', 401, 'UNAUTHORIZED'],
    ['40001', 'SECRET', 503, 'TRADE_RETRY'],
    ['42501', 'SECRET', 503, 'TRADE_NOT_CONFIGURED'],
    ['PGRST202', 'SECRET', 503, 'TRADE_NOT_CONFIGURED'],
    ['XX000', 'SECRET', 503, 'TRADE_STATUS_UNKNOWN'],
  ]) {
    const execute = createTradeExecutor({
      url: 'https://project.test', publicKey: 'public-test',
      fetcher: async () => Response.json({ code: sqlCode, message: sqlMessage, details: 'SECRET' }, { status: 400 }),
    });
    await assert.rejects(execute('user-jwt', { ...order, side: 'buy' }), error =>
      error.status === expectedStatus && error.code === expectedCode && !error.message.includes('SECRET'));
  }
});

test('netinkamas turinys, pašaliniai parametrai ir per didelė užklausa atmetami', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request(order, { body: '{bad-json' }))).status, 400);
  assert.equal((await handler(request(order, { headers: { authorization: 'Bearer user-jwt',
    'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await handler(request({ ...order, price: 1 }))).status, 400);
  assert.equal((await handler(request({ ...order, user_id: USER }))).status, 400);
  assert.equal((await handler(request(order, { body: ' '.repeat(4097) }))).status, 413);
  assert.equal(calls.trade.length, 0);
});

test('CORS, OPTIONS, POST ir query taisyklės', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(new Request('https://example.test/trade', { method: 'OPTIONS',
    headers: { origin: 'http://localhost:5173' } }))).status, 204);
  assert.equal((await handler(new Request('https://example.test/trade'))).status, 405);
  assert.equal((await handler(request(order, { headers: { origin: 'https://evil.test' } }))).status, 403);
  assert.equal((await handler(new Request('https://example.test/trade?price=1', request()))).status, 400);
  assert.equal(calls.trade.length, 0);
});

test('kito vartotojo arba netinkamas sėkmės atsakymas negrąžinamas kaip sėkmė', async () => {
  for (const response of [result({ user_id: TX }), result({ request_id: TX }), result({ total_amount: 'NaN' }), null]) {
    const { handler, calls } = setup({ executeTrade: async () => response });
    const http = await handler(request());
    assert.equal(http.status, 503);
    assert.equal((await http.json()).error.code, 'TRADE_STATUS_UNKNOWN');
    assert.equal(calls.quote.length, 0);
  }
});

test('Auth ir netikėtos serverio klaidos neatskleidžia slaptų tekstų', async () => {
  const backend = createBackend({ url: 'https://project.test', publicKey: 'public-test',
    fetcher: async () => { throw new Error('SECRET'); } });
  const { handler } = setup({ getUser: backend.getUser });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('SECRET'));
});

test('senas sandoris pakartojamas neišgalvojant dienos datos ar naujo apvalinimo', async () => {
  const { handler, calls } = setup({ executeTrade: async () => ({
    ...result({ price: '100.005000', total_amount: '200.01', quote_price: null,
      quote_trading_date: null, quote_fetched_at: null, quote_source: null,
      quote_at: '2026-10-16T12:00:00Z' }),
    replayed: true,
  }) });
  const response = await handler(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.transaction.price, '100.005000');
  assert.equal(body.transaction.quote_price, null);
  assert.equal(body.transaction.quote_trading_date, null);
  assert.equal(body.data_type, 'historical_trade');
  assert.match(body.warning, /naujas apvalinimas netaikomas/);
  assert.equal(calls.quote.length, 0);
});