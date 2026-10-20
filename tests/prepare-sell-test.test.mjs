import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSellTest } from '../scripts/prepare-sell-test.mjs';
const now = Date.now();
function fake(overrides = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) },
    from(table) {
      const filters = [];
      return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
        async maybeSingle() { calls.push({ table, filters }); return { data: table === 'profiles'
          ? { cash_balance: '9657.06' } : { quantity: overrides.quantity ?? 1, average_cost: '342.94' } }; } };
    },
    functions: { async invoke(name) {
      calls.push(name);
      assert.equal(name, 'get-quote?symbol=AAPL', 'trade neturi būti kviečiamas');
      return { data: { symbol: 'AAPL', price: '342.94', fetched_at: new Date(now).toISOString(),
        trading_date: '2026-10-20', cache_fresh: true, price_freshness: 'recent_daily',
        possibly_stale: false, stale: false, is_realtime: false, ...overrides.quote } };
    } },
  };
  return { client, calls };
}
test('Pasiruošimas skaito tik savo duomenis ir kainą, SELL nevykdo', async () => {
  const { client, calls } = fake();
  const result = await prepareSellTest(client, now);
  assert.equal(result.order.side, 'SELL'); assert.equal(result.order.quantity, 1);
  assert.match(result.order.request_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[0].filters, [['id', 'test-user']]);
  assert.deepEqual(calls[1].filters, [['user_id', 'test-user'], ['symbol', 'AAPL']]);
  assert.equal(calls.filter(x => typeof x === 'string').length, 1);
});
test('Nėra akcijų: kaina ir prekyba nekviečiamos', async () => {
  const { client, calls } = fake({ quantity: 0 });
  await assert.rejects(prepareSellTest(client, now));
  assert.equal(calls.some(x => typeof x === 'string'), false);
});
test('Pasenusi arba nepatvirtinta kaina blokuoja pasiruošimą', async () => {
  for (const quote of [{ stale: true }, { cache_fresh: false }, { price_freshness: 'unverified' },
    { fetched_at: new Date(now - 86400000).toISOString() }]) {
    await assert.rejects(prepareSellTest(fake({ quote }).client, now));
  }
});
test('Naujas pasiruošimas gauna naują UUID, atsakyme nėra JWT', async () => {
  const a = await prepareSellTest(fake().client, now);
  const b = await prepareSellTest(fake().client, now);
  assert.notEqual(a.order.request_id, b.order.request_id);
  assert.equal('access_token' in a, false);
});
