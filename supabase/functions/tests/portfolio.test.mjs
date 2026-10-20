import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteService } from '../_shared/quote-service.mjs';
import { valuePortfolio } from '../_shared/portfolio.mjs';
import { createPortfolioReader } from '../_shared/portfolio-rest.mjs';
import { createPortfolioHandler } from '../_shared/portfolio-handler.mjs';
const instant = new Date('2026-10-20T23:00:00Z');
const now = () => instant;
const id = 'a0000000-0000-4000-8000-000000000001';
const snapshot = (positions = []) => ({ user_id: id, cash_balance: '9657.06', snapshot_at: instant.toISOString(), positions });
const pos = (symbol = 'AAPL', quantity = 1, average_cost = '342.940000') => ({ symbol, quantity, average_cost });
const quote = (symbol, price = '342.940000', extra = {}) => ({ symbol, price, trading_date: '2026-10-20',
  fetched_at: instant.toISOString(), cached: true, possibly_stale: false, stale: false, is_realtime: false, ...extra });

test('1 AAPL ir balansas: 10000 USD, nulinis P/L', async () => {
  const result = await valuePortfolio(snapshot([pos()]), async s => quote(s), now);
  assert.equal(result.positions[0].market_value, '342.94');
  assert.equal(result.positions[0].unrealized_profit_loss, '0.00');
  assert.equal(result.total_portfolio_value, '10000.00');
  assert.equal(result.valuation_complete, true);
});
test('Kelios pozicijos: teigiamas ir neigiamas P/L, sumos', async () => {
  const result = await valuePortfolio({ ...snapshot([pos('AAPL', 2, '100'), pos('MSFT', 3, '210')]), cash_balance: '1000.00' },
    async s => quote(s, s === 'AAPL' ? '120' : '200'), now);
  assert.deepEqual(result.positions.map(p => p.market_value), ['240.00', '600.00']);
  assert.deepEqual(result.positions.map(p => p.unrealized_profit_loss), ['40.00', '-30.00']);
  assert.equal(result.total_portfolio_value, '1840.00');
  assert.equal(result.total_unrealized_profit_loss, '10.00');
});
test('Tuščias portfelis: API nekviečiama, vertė lygi balansui', async () => {
  const result = await valuePortfolio(snapshot(), () => assert.fail('Nereikia API'), now);
  assert.equal(result.total_portfolio_value, '9657.06');
  assert.equal(result.holdings_market_value, '0.00');
  assert.equal(result.valuation_complete, true);
});
test('Trūkstama kaina: null, nepilnas vertinimas, atskira žinomų pozicijų suma', async () => {
  const result = await valuePortfolio(snapshot([pos(), pos('MSFT')]), async s => {
    if (s === 'MSFT') throw Error('secret'); return quote(s);
  }, now);
  assert.equal(result.valuation_complete, false);
  assert.equal(result.total_portfolio_value, null); assert.equal(result.holdings_market_value, null);
  assert.equal(result.total_unrealized_profit_loss, null);
  assert.equal(result.valued_positions_market_value, '342.94');
  assert.equal(result.positions[1].current_price, null);
  assert.equal(result.positions[1].market_value, null);
  assert.deepEqual(result.missing_symbols, ['MSFT']);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
for (const [name, change] of Object.entries({ outdated: { trading_date: '2026-10-19' },
  expired: { fetched_at: '2026-10-19T23:00:00Z' }, future: { fetched_at: '2026-10-21T00:00:00Z' },
  fallback: { possibly_stale: true }, wrongSymbol: { symbol: 'TSLA' },
  invalidPrice: { price: 'NaN' }, invalidDate: { trading_date: '2026-02-30' } })) {
  test('Netinkama kaina neįtraukiama: ' + name, async () => {
    const result = await valuePortfolio(snapshot([pos()]), async s => quote(s, '342.94', change), now);
    assert.equal(result.valuation_complete, false); assert.equal(result.positions[0].market_value, null);
  });
}
test('Savaitgalį penktadienio kaina tinka, tačiau nėra realaus laiko', async () => {
  const saturday = new Date('2026-10-24T10:00:00Z');
  const result = await valuePortfolio(snapshot([pos()]), async s => quote(s, '342.94', {
    fetched_at: saturday.toISOString(), trading_date: '2026-10-23' }), () => saturday);
  assert.equal(result.valuation_complete, true); assert.equal(result.is_realtime, false);
});
test('Tiksli didelių sumų ir dalinių centų aritmetika be JS Number pinigams', async () => {
  const large = await valuePortfolio({ ...snapshot([pos('AAPL', 1, '999999999999.990000')]), cash_balance: '9999999999999999.99' },
    async s => quote(s, '999999999999.994999'), now);
  assert.equal(large.positions[0].market_value, '999999999999.99');
  assert.equal(large.total_portfolio_value, '10000999999999999.98');
  const small = await valuePortfolio(snapshot([pos('AAPL', 3, '0.020000')]), async s => quote(s, '0.015000'), now);
  assert.equal(small.positions[0].market_value, '0.05');
  assert.equal(small.positions[0].unrealized_profit_loss, '-0.02');
});
test('Netinkami DB duomenys atmetami iki kainų API', async () => {
  for (const data of [{ ...snapshot(), cash_balance: 'NaN' }, snapshot([pos('AAPL', 0)]),
    snapshot([pos(), pos()]), snapshot([pos('AAPL', 1, '0')])]) {
    await assert.rejects(valuePortfolio(data, () => assert.fail('API negalima'), now));
  }
});
test('REST skaitymas: vartotojo JWT, viešas apikey, jokių user_id parametrų', async () => {
  const read = createPortfolioReader({ url: 'https://example.invalid', publicKey: 'public-test', fetcher: async (url, options) => {
    assert.ok(url.endsWith('/rpc/get_portfolio_snapshot')); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer user-test'); assert.equal(options.headers.apikey, 'public-test');
    assert.equal(options.body, '{}'); return Response.json(snapshot([pos()]));
  } });
  assert.equal((await read('user-test', id)).cash_balance, '9657.06');
});
test('REST atmeta svetimą vartotoją, netinkamą JSON ir DB klaidas neatskleisdamas turinio', async () => {
  for (const response of [Response.json({ ...snapshot(), user_id: 'foreign' }), new Response('bad'),
    new Response('secret', { status: 500 }), Response.json(null)]) {
    const read = createPortfolioReader({ url: 'https://example.invalid', publicKey: 'public-test', fetcher: async () => response });
    await assert.rejects(read('user-test', id), error => !error.message.includes('secret'));
  }
});
function handler(overrides = {}) {
  return createPortfolioHandler({ getUser: async () => ({ id, role: 'authenticated' }),
    readPortfolio: async () => snapshot([pos()]), getQuote: async s => quote(s),
    origins: ['http://localhost:5173'], now, ...overrides });
}
const request = (headers = {}, method = 'GET', query = '') => new Request('https://example.invalid/portfolio' + query,
  { method, headers: { origin: 'http://localhost:5173', ...headers } });
test('HTTP: GET sėkmė su JWT, be vartotojo ID atsakyme', async () => {
  const response = await handler()(request({ authorization: 'Bearer user-test' }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json(); assert.equal(data.total_portfolio_value, '10000.00');
  assert.equal('user_id' in data, false);
});
test('HTTP: be JWT arba netinkamas JWT / vaidmuo nepasiekia duomenų ir API', async () => {
  for (const user of [null, { id, role: 'service_role' }, { id: 'bad', role: 'authenticated' }]) {
    const response = await handler({ getUser: async () => user, readPortfolio: () => assert.fail('Negalima DB') })(request({ authorization: 'Bearer bad' }));
    assert.equal(response.status, 401);
  }
  assert.equal((await handler({ readPortfolio: () => assert.fail('Negalima DB') })(request())).status, 401);
});
test('HTTP: CORS, metodai, query ir sanitizuotos klaidos', async () => {
  assert.equal((await handler()(request({}, 'OPTIONS'))).status, 204);
  assert.equal((await handler()(request({}, 'POST'))).status, 405);
  assert.equal((await handler()(request({ origin: 'https://forbidden.invalid' }))).status, 403);
  assert.equal((await handler()(request({ authorization: 'Bearer user-test' }, 'GET', '?user_id=foreign'))).status, 400);
  const response = await handler({ readPortfolio: async () => { throw Error('secret'); } })(request({ authorization: 'Bearer user-test' }));
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('secret'), false);
});

test('Esama kainų paslauga išlaiko kvotą: nėra išorinio kvietimo limitui pasibaigus', async () => {
  let providerCalls = 0;
  const getQuote = createQuoteService({ apiKey: 'mock-only', now,
    store: { reserve: async symbol => symbol === 'AAPL'
      ? { action: 'cache', quote: { ...quote(symbol), price: '342.94' } }
      : { action: 'quota' } },
    fetcher: async () => { providerCalls++; throw Error('Neturėtų būti kviečiama'); },
  });
  const result = await valuePortfolio(snapshot([pos(), pos('MSFT')]), getQuote, now);
  assert.equal(providerCalls, 0); assert.equal(result.valuation_complete, false);
  assert.equal(result.positions[0].market_value, '342.94');
  assert.equal(result.positions[1].market_value, null);
});
test('Bendros sumos sutampa su suapvalintomis pozicijų eilutėmis', async () => {
  const result = await valuePortfolio({ ...snapshot([pos('AAPL', 1, '0.01'), pos('MSFT', 1, '0.01')]), cash_balance: '0.00' },
    async s => quote(s, '0.015'), now);
  assert.deepEqual(result.positions.map(p => p.market_value), ['0.02', '0.02']);
  assert.equal(result.holdings_market_value, '0.04');
  assert.equal(result.total_portfolio_value, '0.04');
});
