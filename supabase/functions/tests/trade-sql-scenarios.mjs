// HTTP imituojamas, bet finansiniai RPC vykdomi tikroje vietinėje PGlite SQL schemoje.
// Nenaudojamas tinklas, Supabase projektas ar tikri JWT / API raktai.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBackend } from '../_shared/supabase-rest.mjs';
import { createTradeExecutor } from '../_shared/trade-rest.mjs';
import { createTradeHandler } from '../_shared/trade-handler.mjs';
import { createQuoteService } from '../_shared/quote-service.mjs';

export async function runTradeSqlScenarios(db) {
  const users = {
    'user-a': 'c0000000-0000-4000-8000-000000000001',
    'user-b': 'c0000000-0000-4000-8000-000000000002',
    'user-large': 'c0000000-0000-4000-8000-000000000003',
  };
  let checks = 0;
  let providerCalls = 0;
  let financialCalls = 0;
  let loseNextReply = false;
  const check = (actual, expected, name) => { assert.deepEqual(actual, expected, name); checks++; };
  await db.exec('begin');
  try {
    for (const id of Object.values(users)) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, id + '@example.invalid']);
    }
    const session = (await db.query(
      'select trading_private.expected_trading_date(clock_timestamp())::text as date')).rows[0].date;
    assert.ok(session);
    await db.query(`
      insert into public.av_quote_cache(symbol,price,trading_date,fetched_at)
      values('IBM',100.005,$1::date,clock_timestamp())
    `, [session]);
    async function sqlRpc(name, params, role, claims) {
      await db.exec('savepoint trade_api_request');
      try {
        await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
        await db.exec('set local role ' + role);
        let row;
        if (['buy_stock', 'sell_stock'].includes(name)) {
          row = (await db.query('select public.' + name + '($1::uuid,$2::text,$3::integer)::text as value',
            [params.p_request_id, params.p_symbol, params.p_quantity])).rows[0];
        } else if (name === 'av_reserve_quote') {
          row = (await db.query('select public.av_reserve_quote($1::text)::text as value',
            [params.p_symbol])).rows[0];
        } else if (name === 'av_finish_quote') {
          await db.query('select public.av_finish_quote($1::text,$2::uuid,$3::numeric,$4::date,$5::boolean)',
            [params.p_symbol, params.p_lease, params.p_price, params.p_trading_date, params.p_rate_limited]);
          row = { value: 'null' };
        } else throw new Error('Nenumatytas RPC');
        await db.exec('reset role; release savepoint trade_api_request');
        return new Response(row.value, { headers: { 'content-type': 'application/json' } });
      } catch (error) {
        await db.exec('rollback to savepoint trade_api_request; release savepoint trade_api_request');
        return Response.json({ code: error.code, message: error.message }, { status: 400 });
      }
    }
    const fetcher = async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'www.alphavantage.co') {
        providerCalls++;
        return Response.json({ 'Global Quote': {
          '01. symbol': url.searchParams.get('symbol'), '05. price': '0.015000',
          '07. latest trading day': session,
        } });
      }
      const bearer = options.headers?.Authorization?.replace('Bearer ', '');
      if (url.pathname === '/auth/v1/user') {
        return users[bearer]
          ? Response.json({ id: users[bearer], role: 'authenticated' })
          : Response.json({ message: 'Invalid JWT' }, { status: 401 });
      }
      const name = url.pathname.split('/').at(-1);
      const financial = ['buy_stock', 'sell_stock'].includes(name);
      if (financial) {
        financialCalls++;
        check(options.headers.apikey, 'public-test', 'Finansiniam RPC viešas projekto raktas');
        assert.ok(users[bearer], 'Finansiniam RPC vartotojo JWT');
      } else {
        check(bearer, 'admin-test', 'Kainų RPC administratoriaus raktas');
      }
      const response = await sqlRpc(name, JSON.parse(options.body),
        financial ? 'authenticated' : 'service_role',
        financial ? { sub: users[bearer], role: 'authenticated' } : { role: 'service_role' });
      if (financial && loseNextReply && response.ok) {
        loseNextReply = false;
        throw new Error('Imituotas atsakymo praradimas PO SQL sėkmės');
      }
      return response;
    };
    const backend = createBackend({
      url: 'https://project.test', publicKey: 'public-test', serviceKey: 'admin-test', fetcher,
    });
    const handler = createTradeHandler({
      getUser: backend.getUser,
      executeTrade: createTradeExecutor({ url: 'https://project.test', publicKey: 'public-test', fetcher }),
      getQuote: createQuoteService({ store: backend.store, apiKey: 'provider-test', fetcher }),
      origins: [],
    });
    async function trade(token, requestId, side = 'BUY', quantity = 2, symbol = 'IBM') {
      const response = await handler(new Request('https://example.test/trade', {
        method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, side, quantity, symbol }),
      }));
      return { status: response.status, body: await response.json() };
    }
    const balance = async token => (await db.query(
      'select cash_balance::text as value from public.profiles where id=$1', [users[token]])).rows[0].value;
    const firstId = randomUUID();
    const first = await trade('user-a', firstId);
    check(first.status, 201, 'HTTP BUY vykdomas per tikrą SQL');
    check(first.body.transaction.price, '100.010000', 'SQL centų vykdymo įkainis');
    check(first.body.transaction.quote_price, '100.005000', 'Pradinė API kaina išlieka');
    check(first.body.transaction.total_amount, '200.02', 'SQL ir HTTP sumos sutampa');
    check(await balance('user-a'), '9799.98', 'BUY balansas');
    check(providerCalls, 0, 'Tinkama DB talpykla nenaudoja API');

    const replay = await trade('user-a', firstId);
    check(replay.status, 200, 'Pakartojimas HTTP 200');
    check(replay.body.transaction.id, first.body.transaction.id, 'Pakartojimas grąžina tą patį sandorį');
    check(replay.body.replayed, true, 'SQL patvirtina pakartojimą');
    check(await balance('user-a'), '9799.98', 'Pakartojimas nekeičia balanso');
    check((await trade('user-a', firstId, 'BUY', 3)).body.error.code,
      'REQUEST_ID_CONFLICT', 'Pakeisti parametrai atmetami');
    check((await trade('user-a', randomUUID(), 'BUY', 100000)).body.error.code,
      'INSUFFICIENT_FUNDS', 'SQL nepakankamas balansas');
    check((await trade('user-a', randomUUID(), 'SELL', 3)).body.error.code,
      'INSUFFICIENT_SHARES', 'SQL nepakankamas akcijų kiekis');
    check((await trade('user-a', randomUUID(), 'SELL', 1)).status, 201, 'HTTP SELL');
    check(await balance('user-a'), '9899.99', 'SELL balansas');
    check((await trade('user-b', firstId, 'BUY', 1)).status, 201, 'Tas pats ID kitam vartotojui nepriklausomas');
    check(await balance('user-a'), '9899.99', 'Svetimas sandoris nekeičia balanso');

    const lostId = randomUUID();
    loseNextReply = true;
    const lost = await trade('user-a', lostId, 'BUY', 1);
    check(lost.body.error.code, 'TRADE_STATUS_UNKNOWN', 'Prarasto atsakymo baigtis neįvardijama nesėkme');
    check(await balance('user-a'), '9799.98', 'SQL įvykdytas vieną kartą prieš prarandant atsakymą');
    const recovered = await trade('user-a', lostId, 'BUY', 1);
    check(recovered.body.replayed, true, 'Prarastas atsakymas atkuriamas tuo pačiu ID');
    check(await balance('user-a'), '9799.98', 'Atkūrimas nedubliuoja pavedimo');

    const refreshId = randomUUID();
    const refreshed = await trade('user-a', refreshId, 'BUY', 2, 'AMD');
    check(refreshed.status, 201, 'Trūkstama kaina gaunama bendru Alpha Vantage keliu');
    check(refreshed.body.transaction.price, '0.020000', 'Atnaujinta kaina normalizuojama tik SQL');
    check(refreshed.body.transaction.total_amount, '0.04', 'Skaidymo spragos negrąžina HTTP sluoksnis');
    check(providerCalls, 1, 'Vienas išorinis kainų kvietimas');
    check((await trade('user-a', refreshId, 'BUY', 2, 'AMD')).body.replayed, true,
      'Pakartojimas po kainos gavimo');
    check(providerCalls, 1, 'Pakartojimas nesunaudoja kvotos');

    await db.exec("update public.av_quote_cache set trading_date=(clock_timestamp() at time zone 'UTC')::date-7 where symbol='AMD'");
    check((await trade('user-a', randomUUID(), 'BUY', 1, 'AMD')).body.error.code,
      'QUOTE_STALE', 'Per sena kaina neleidžiama');
    check(providerCalls, 1, 'Sena dar galiojančio TTL talpykla nepralaužia kvotos');
    await db.exec("insert into public.av_api_requests(requested_at) select clock_timestamp() from generate_series(1,24)");
    check((await trade('user-a', randomUUID(), 'BUY', 1, 'AAPL')).status, 429, 'Bendra SQL API kvota taikoma prekybai');
    check(providerCalls, 1, 'Išnaudojus kvotą nėra išorinio kvietimo');

    await db.query('update public.profiles set cash_balance=9999999999999999.99 where id=$1', [users['user-large']]);
    await db.query(`insert into public.av_quote_cache(symbol,price,trading_date,fetched_at)
      values('NVDA',999999999999.994999,$1::date,clock_timestamp())`, [session]);
    const large = await trade('user-large', randomUUID(), 'BUY', 10000, 'NVDA');
    check(large.status, 201, 'Didelė SQL suma priimama');
    check(large.body.transaction.total_amount, '9999999999999900.00', 'HTTP nepraranda centų didelėje sumoje');
    check(large.body.transaction.quote_price, '999999999999.994999', 'HTTP išsaugo API kainos tikslumą');
    check(await balance('user-large'), '99.99', 'Didelio sandorio balansas tikslus');

    const beforeInvalidJwt = financialCalls;
    check((await trade('invalid-jwt', randomUUID())).status, 401, 'Netinkamas JWT atmetamas');
    check(financialCalls, beforeInvalidJwt, 'Netinkamas JWT nepasiekia SQL');
    return checks;
  } finally {
    await db.exec('rollback');
  }
}