import test from 'node:test';
import assert from 'node:assert/strict';
import { submitTrade } from '../src/services/trading.mjs';
import { createTradeHandler } from '../supabase/functions/_shared/trade-handler.mjs';
const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = '11111111-1111-4111-8111-111111111111';
function setup() {
  const records = new Map();
  const handler = createTradeHandler({
    getUser: async () => ({ id: user, role: 'authenticated' }),
    executeTrade: async (_token, order) => {
      const previous = records.get(order.request_id);
      if (previous) return { replayed: true, transaction: previous };
      const transaction = {
        ...order, id: '22222222-2222-4222-8222-222222222222', user_id: user,
        quantity: String(order.quantity), price: '342.94', total_amount: '342.94',
        quote_price: '342.940000', quote_trading_date: '2026-10-19',
        quote_fetched_at: '2026-10-20T10:00:00Z', quote_source: 'Alpha Vantage',
        executed_at: '2026-10-20T10:00:00Z', quote_at: null,
      };
      records.set(order.request_id, transaction);
      return { replayed: false, transaction };
    },
    getQuote: async () => { throw Error('cached execution must not fetch quotes'); },
    origins: [],
  });
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: user }, access_token: 'test-only-token' } } }) },
    functions: { invoke: async (name, options) => {
      assert.equal(name, 'trade');
      const result = await handler(new Request('https://example.test/trade', {
        method: options.method, headers: { ...options.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(options.body),
      }));
      assert.ok(result.ok);
      return { data: await result.json() };
    } },
  };
  return { client, records };
}
for (const side of ['BUY', 'SELL']) {
  test(side + ' frontend accepts canonical backend response and safely replays same order', async () => {
    const { client, records } = setup();
    const order = { symbol: 'AAPL', side, quantity: 1, request_id: id };
    const result = await submitTrade(client, order, user);
    assert.equal(result.transaction.side, side.toLowerCase());
    assert.equal(result.transaction.total_amount, '342.94');
    assert.equal(result.replayed, false);
    const replay = await submitTrade(client, order, user);
    assert.equal(replay.replayed, true);
    assert.equal(replay.transaction.id, result.transaction.id);
    assert.equal(records.size, 1);
  });
}
test('opposite side is still rejected as an unconfirmed response', async () => {
  const { client } = setup();
  const original = client.functions.invoke;
  client.functions.invoke = async (...args) => {
    const result = await original(...args);
    result.data.transaction.side = 'sell';
    return result;
  };
  await assert.rejects(submitTrade(client, { symbol: 'AAPL', side: 'BUY', quantity: 1, request_id: id }, user), error => !error.definitive);
});
