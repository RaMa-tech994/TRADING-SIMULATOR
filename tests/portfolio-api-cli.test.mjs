import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPortfolioResponse, runPortfolioTest } from '../scripts/test-portfolio-api.mjs';
const data = () => ({ currency: 'USD', data_type: 'end_of_day', is_realtime: false,
  snapshot_at: '2026-10-20T23:00:00Z', valued_at: '2026-10-20T23:00:01Z',
  valuation_complete: true, missing_symbols: [], cash_balance: '10000.00', positions: [],
  valued_positions_market_value: '0.00', holdings_market_value: '0.00',
  total_portfolio_value: '10000.00', total_unrealized_profit_loss: '0.00' });
test('Tuščias portfelis ir neteisinga bendra suma', () => {
  assert.equal(checkPortfolioResponse(data()).valid, true);
  assert.equal(checkPortfolioResponse({ ...data(), total_portfolio_value: '0.00' }).valid, false);
});
test('Pozicijos vertė ir neigiamas P/L patikrinami tiksliai', () => {
  const body = { ...data(), cash_balance: '0.00', valued_positions_market_value: '600.00',
    holdings_market_value: '600.00', total_portfolio_value: '600.00', total_unrealized_profit_loss: '-30.00',
    positions: [{ symbol: 'MSFT', quantity: 3, average_cost: '210.000000', current_price: '200.000000',
      trading_date: '2026-10-20', valuation_status: 'valued', possibly_stale: false,
      cache_fresh: true, price_freshness: 'recent_daily', market_value: '600.00', unrealized_profit_loss: '-30.00' }] };
  assert.equal(checkPortfolioResponse(body).valid, true);
  body.positions[0].unrealized_profit_loss = '30.00';
  assert.equal(checkPortfolioResponse(body).valid, false);
});
test('Nepilnas vertinimas privalo turėti null bendras vertes', () => {
  const body = { ...data(), valuation_complete: false, missing_symbols: ['AAPL'],
    positions: [{ symbol: 'AAPL', quantity: 1, average_cost: '342.94', valuation_status: 'unavailable',
      market_value: null, unrealized_profit_loss: null }],
    holdings_market_value: null, total_portfolio_value: null, total_unrealized_profit_loss: null };
  assert.deepEqual(checkPortfolioResponse(body), { valid: true, complete: false, errors: [] });
  body.total_portfolio_value = '10000.00'; assert.equal(checkPortfolioResponse(body).valid, false);
});
test('API testas kviečia tik portfolio ir savo skaitymo RPC, ne trade', async () => {
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'own', role: 'authenticated' } } }) },
    functions: { invoke: async (name, options) => { calls.push(name); assert.equal(options.method, 'GET'); return { data: data() }; } },
    rpc: async name => { calls.push(name); return { data: { user_id: 'own', cash_balance: '10000.00', positions: [] } }; } };
  assert.equal((await runPortfolioTest(client)).ownDataVerified, true);
  assert.deepEqual(calls, ['portfolio', 'get_portfolio_snapshot']);
});
test('Svetimo vartotojo RPC duomenys nelaikomi patvirtintais', async () => {
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'own', role: 'authenticated' } } }) },
    functions: { invoke: async () => ({ data: data() }) },
    rpc: async () => ({ data: { user_id: 'foreign', cash_balance: '10000.00', positions: [] } }) };
  assert.equal((await runPortfolioTest(client)).ownDataVerified, false);
});
test('Autentifikacijos klaida sustabdo testą prieš API', async () => {
  const client = { auth: { getUser: async () => ({ error: true }) },
    functions: { invoke: () => assert.fail('API neturi būti kviečiama') } };
  await assert.rejects(runPortfolioTest(client));
});
