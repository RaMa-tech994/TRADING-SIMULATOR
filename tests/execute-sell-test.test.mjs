import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Writable } from 'node:stream';
import { executeConfirmedSell, createSellOrder } from '../scripts/execute-sell-test.mjs';

test('Nauji sandoriai gauna skirtingus UUID', () => {
  const a = createSellOrder(), b = createSellOrder();
  assert.match(a.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a.request_id, b.request_id);
  assert.equal(Object.isFrozen(a), true);
});
test('Pakartojimas naudoja nurodytą UUID, netinkama įvestis nekuria naujo ID', () => {
  const order = createSellOrder();
  assert.deepEqual(createSellOrder(['--request-id', order.request_id]), order);
  for (const args of [['--request-id'], ['--request-id', 'bad'], ['--unknown'], ['bad'], ['--request-id', '', 'extra']]) {
    assert.throws(() => createSellOrder(args));
  }
});
test('Be tikslaus patvirtinimo SELL nesiunčiamas, įskaitant pakartojimą', async () => {
  const client = { functions: { invoke() { assert.fail('Negalima vykdyti'); } } };
  const order = createSellOrder();
  for (const text of ['', 'taip', 'PARDUOTI 2 AAPL', ' PARDUOTI 1 AAPL']) {
    assert.equal((await executeConfirmedSell(client, 'test-token', text, order)).cancelled, true);
  }
});
test('Tik vienas SELL su pasirinktu ID ir vartotojo JWT', async () => {
  let calls = 0; const order = createSellOrder();
  const client = { functions: { async invoke(name, options) {
    calls++; assert.equal(name, 'trade'); assert.equal(options.method, 'POST');
    assert.deepEqual(options.body, order);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { data: { success: true, request_id: order.request_id, replayed: false,
      transaction: { ...order, side: 'sell', price: '342.94', total_amount: '342.94' } } };
  } } };
  assert.equal((await executeConfirmedSell(client, 'test-token', 'PARDUOTI 1 AAPL', order)).success, true);
  assert.equal(calls, 1);
});
test('Neaiški baigtis nekartojama automatiškai; rankinis pakartojimas išsaugo UUID', async () => {
  const order = createSellOrder(); const ids = [];
  const client = { functions: { async invoke(_name, options) {
    ids.push(options.body.request_id);
    if (ids.length === 1) throw new Error('secret');
    return { data: { success: true, request_id: order.request_id, replayed: true,
      transaction: { ...order, side: 'sell', price: '342.94', total_amount: '342.94' } } };
  } } };
  assert.deepEqual(await executeConfirmedSell(client, 'test-token', 'PARDUOTI 1 AAPL', order), { uncertain: true });
  assert.equal(ids.length, 1);
  const retry = createSellOrder(['--request-id', order.request_id]);
  const result = await executeConfirmedSell(client, 'test-token', 'PARDUOTI 1 AAPL', retry);
  assert.equal(result.success, true); assert.equal(result.replayed, true);
  assert.deepEqual(ids, [order.request_id, order.request_id]);
});
test('Trūkstamas ID, netinkamas kiekis ar kitas simbolis neleidžia siųsti pavedimo', async () => {
  const client = { functions: { invoke() { assert.fail('Negalima vykdyti'); } } };
  const order = createSellOrder();
  for (const invalid of [undefined, { ...order, request_id: 'bad' }, { ...order, quantity: 2 },
    { ...order, symbol: 'TSLA' }, { ...order, side: 'BUY' }]) {
    assert.equal((await executeConfirmedSell(client, 'test-token', 'PARDUOTI 1 AAPL', invalid)).invalid, true);
  }
});

// Paleidžiamas tikras main() kodas su imituotu terminalu, Auth, failais ir API.
// Taip tikrinamas CLI argumento perdavimas, ne tik atskira pagalbinė funkcija.
for (const confirmation of ['PARDUOTI 1 AAPL', 'atšaukti']) {
  test('CLI kelias: ' + confirmation, async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const calls = [], logs = [];
    const answers = ['test@example.invalid', 'fake-password', confirmation];
    let closed = false, stopped = false;
    const client = {
      auth: {
        async signInWithPassword(credentials) {
          assert.deepEqual(JSON.parse(JSON.stringify(credentials)), { email: 'test@example.invalid', password: 'fake-password' });
          return { data: { session: { access_token: 'fake-jwt', user: { id: 'user-a' } } } };
        },
        async getUser() { return { data: { user: { id: 'user-a', role: 'authenticated' } } }; },
        stopAutoRefresh() { stopped = true; },
      },
      functions: { async invoke(name, options) {
        calls.push(name);
        assert.equal(options.headers.Authorization, 'Bearer fake-jwt');
        if (name === 'get-quote?symbol=AAPL') return { data: {
          symbol: 'AAPL', price: '342.94', fetched_at: new Date().toISOString(), trading_date: '2026-10-20',
          cache_fresh: true, price_freshness: 'recent_daily', possibly_stale: false, stale: false, is_realtime: false,
        } };
        assert.equal(name, 'trade');
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(JSON.stringify(options.body)), {
          symbol: 'AAPL', side: 'SELL', quantity: 1, request_id: id,
        });
        return { data: { success: true, request_id: id, replayed: false,
          transaction: { ...options.body, side: 'sell', price: '342.94', total_amount: '342.94' } } };
      } },
    };
    const cliSource = readFileSync(new URL('../scripts/execute-sell-test.mjs', import.meta.url), 'utf8');
    const executable = cliSource.slice(0, cliSource.indexOf('if (process.argv[1]'))
      .replace(/^import .*;\r?$/gm, '').replaceAll('export ', '');
    await runInNewContext(executable + '\nmain();', {
      createClient: () => client,
      readFileSync: () => '', parseEnv: () => ({}), Writable,
      createInterface: () => ({ question: async () => answers.shift(), close() { closed = true; } }),
      randomUUID: () => { assert.fail('Pakartojimo ID negali būti generuojamas'); },
      process: { argv: ['node', 'script', '--request-id', id], stdin: { isTTY: true },
        stdout: { isTTY: true, write: () => true },
        env: { VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mock' } },
      console: { info: (...args) => logs.push(args.join(' ')) },
    });
    assert.deepEqual(calls, confirmation === 'PARDUOTI 1 AAPL' ? ['get-quote?symbol=AAPL', 'trade'] : ['get-quote?symbol=AAPL']);
    assert.equal(closed, true); assert.equal(stopped, true);
    assert.equal(logs.join(' ').includes('fake-password'), false);
    assert.equal(logs.join(' ').includes('fake-jwt'), false);
    if (confirmation === 'PARDUOTI 1 AAPL') assert.ok(logs.some(line => line.includes('SELL sėkmingas.')));
  });
}
