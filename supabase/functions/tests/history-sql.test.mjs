// Tik izoliuota PGlite atminties DB; visi HTTP ir Auth atsakymai imituoti.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackend } from '../_shared/supabase-rest.mjs';
import { createChartBackend } from '../_shared/chart-rest.mjs';
import { createPortfolioReader } from '../_shared/portfolio-rest.mjs';
import { createQuoteService } from '../_shared/quote-service.mjs';
import { createPriceHistoryService } from '../_shared/price-history.mjs';
import { createPriceHistoryHandler } from '../_shared/price-history-handler.mjs';
import { createPortfolioHistoryHandler } from '../_shared/portfolio-history-handler.mjs';
const modulePath = process.env.PGLITE_MODULE_PATH || join(process.env.TEMP || '/tmp', 'trading-simulator-sql-tools/node_modules/@electric-sql/pglite/dist/index.js');
test('History HTTP ir 001–005 SQL integracija', { skip: !existsSync(modulePath) }, async t => {
  const { PGlite } = await import(pathToFileURL(modulePath).href); const db = new PGlite();
  const a = 'a0000000-0000-4000-8000-000000000001', b = 'b0000000-0000-4000-8000-000000000002', c = 'c0000000-0000-4000-8000-000000000003';
  const reqId = '10000000-0000-4000-8000-000000000001', lostId = '20000000-0000-4000-8000-000000000002';
  const users = { 'token-a': a, 'token-b': b, 'token-c': c };
  let expected, providerCalls = 0, rpcCalls = 0, loseReply = false;
  const spec = {
    av_reserve_price_history: ['select public.av_reserve_price_history($1::text) as data',['p_symbol']],
    av_finish_price_history: ['select public.av_finish_price_history($1::text,$2::uuid,$3::jsonb,$4::boolean) as data',['p_symbol','p_lease','p_points','p_rate_limited']],
    av_reserve_quote: ['select public.av_reserve_quote($1::text) as data',['p_symbol']],
    av_finish_quote: ['select public.av_finish_quote($1::text,$2::uuid,$3::numeric,$4::date,$5::boolean) as data',['p_symbol','p_lease','p_price','p_trading_date','p_rate_limited']],
    get_portfolio_history: ['select public.get_portfolio_history($1::timestamptz,$2::timestamptz,$3::integer) as data',['p_from','p_to','p_limit']],
    capture_portfolio_snapshot: ['select public.capture_portfolio_snapshot($1::uuid) as data',['p_request_id']],
    get_portfolio_snapshot: ['select public.get_portfolio_snapshot() as data',[]],
  };
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'www.alphavantage.co') {
      providerCalls++; assert.equal(url.searchParams.get('function'),'TIME_SERIES_DAILY');
      return Response.json({ 'Meta Data': { '2. Symbol': url.searchParams.get('symbol') }, 'Time Series (Daily)': { [expected]: { '4. close': '342.940000' } } });
    }
    const token = options.headers?.Authorization?.replace('Bearer ','');
    if (url.pathname === '/auth/v1/user') return users[token] ? Response.json({ id: users[token], role: 'authenticated' }) : Response.json({}, { status: 401 });
    const name = url.pathname.split('/').at(-1), admin = token === 'admin-test';
    assert.ok(Object.hasOwn(spec,name),'Neplanuotas RPC');
    assert.equal(options.headers.apikey,admin ? 'admin-test' : 'public-test');
    if (!admin && !users[token]) return Response.json({}, { status: 401 });
    rpcCalls++; const body = JSON.parse(options.body), [sql,keys] = spec[name];
    const params = keys.map(key => key === 'p_points' && body[key] !== null ? JSON.stringify(body[key]) : body[key]);
    await db.exec('reset role;');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[admin ? '' : users[token],admin ? 'service_role' : 'authenticated']);
    await db.exec(admin ? 'set role service_role;' : 'set role authenticated;');
    let result;
    try { result = await db.query(sql,params); }
    catch (error) { return Response.json({code:error.code,message:error.message},{status:error.code === '42501' ? 403 : 400}); }
    finally { await db.exec('reset role;'); }
    if (name === 'capture_portfolio_snapshot' && loseReply) { loseReply=false; throw Error('Imituotas atsakymo praradimas'); }
    return name.startsWith('av_finish') ? new Response(null,{status:204}) : Response.json(result.rows[0].data);
  };
  const http = (method='GET',token='token-a',body,query='') => new Request('https://example.invalid/endpoint'+query,{method,
    headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try {
    await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
      alter default privileges in schema public grant all on tables to service_role;
      create schema auth;grant usage on schema auth to anon,authenticated,service_role;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),''); $$;`);
    for (const file of ['001_initial_schema.sql','002_alpha_vantage_cache.sql','003_buy_sell.sql','004_portfolio_snapshot.sql','005_chart_history.sql']) await db.exec(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8'));
    expected=(await db.query('select trading_private.expected_trading_date(clock_timestamp())::text as date')).rows[0].date;assert.ok(expected);
    await db.exec(`insert into auth.users values ('${a}'),('${b}'),('${c}');update profiles set cash_balance=9657.06 where id='${a}';
      insert into positions(user_id,symbol,quantity,average_cost) values ('${a}','AAPL',1,342.94);
      insert into av_quote_cache(symbol,price,trading_date,fetched_at) values ('AAPL',342.94,'${expected}',clock_timestamp());`);
    const url='https://example.invalid',publicKey='public-test',serviceKey='admin-test';
    const backend=createBackend({url,publicKey,serviceKey,fetcher}),chart=createChartBackend({url,publicKey,serviceKey,fetcher});
    const price=createPriceHistoryHandler({getUser:backend.getUser,getHistory:createPriceHistoryService({store:chart.priceStore,apiKey:'provider-test',fetcher}),origins:[]});
    const portfolio=createPortfolioHistoryHandler({getUser:backend.getUser,list:chart.list,capture:chart.capture,
      readPortfolio:createPortfolioReader({url,publicKey,fetcher}),getQuote:createQuoteService({store:backend.store,apiKey:'provider-test',fetcher}),origins:[]});
    await t.test('Blogas JWT nepasiekia SQL ir tiekėjo',async()=>{
      const before=rpcCalls;assert.equal((await price(http('GET','bad',null,'?symbol=AAPL'))).status,401);
      assert.equal((await portfolio(http('POST','bad',{request_id:reqId}))).status,401);assert.equal(rpcCalls,before);assert.equal(providerCalls,0);
    });
    await t.test('Kainų rezervacija, įrašymas ir talpykla naudoja tik vieną API užklausą',async()=>{
      const response=await price(http('GET','token-a',null,'?symbol=AAPL'));assert.equal(response.status,200);
      assert.equal((await response.json()).points[0].close,'342.940000');assert.equal(providerCalls,1);
      const cached=await price(http('GET','token-b',null,'?symbol=AAPL'));assert.equal((await cached.json()).cached,true);assert.equal(providerCalls,1);
      assert.equal((await db.query('select count(*)::int as n from av_api_requests')).rows[0].n,1);
    });
    await t.test('GET nesukuria istorijos, POST ir pakartojimas nedubliuoja taško',async()=>{
      assert.deepEqual((await (await portfolio(http())).json()).points,[]);
      const first=await portfolio(http('POST','token-a',{request_id:reqId}));assert.equal(first.status,201);
      const data=await first.json();assert.equal(data.snapshot.portfolio_value,'10000.00');assert.equal(data.snapshot.total_profit_loss,'0.00');
      const second=await portfolio(http('POST','token-a',{request_id:reqId}));assert.equal(second.status,200);assert.equal((await second.json()).replayed,true);
      assert.equal((await db.query('select count(*)::int as n from snapshots')).rows[0].n,1);assert.equal(providerCalls,1);
    });
    await t.test('Vartotojų atskyrimas ir minutės ribojimas',async()=>{
      assert.deepEqual((await (await portfolio(http('GET','token-b'))).json()).points,[]);
      const other=await portfolio(http('POST','token-b',{request_id:reqId}));assert.equal(other.status,201);assert.deepEqual((await other.json()).snapshot.valuation_details.prices,{});
      const limited=await portfolio(http('POST','token-a',{request_id:'30000000-0000-4000-8000-000000000003'}));assert.equal(limited.status,429);
      assert.equal((await portfolio(http('POST','token-a',{request_id:reqId,user_id:b}))).status,400);
    });
    await t.test('Prarastas atsakymas: neaiški baigtis ir saugus rankinis pakartojimas',async()=>{
      loseReply=true;const response=await portfolio(http('POST','token-c',{request_id:lostId}));assert.equal(response.status,503);
      const error=(await response.json()).error;assert.equal(error.code,'SNAPSHOT_STATUS_UNKNOWN');assert.equal(error.request_id,lostId);
      assert.equal((await db.query('select count(*)::int as n from snapshots where user_id=$1',[c])).rows[0].n,1);
      const retry=await portfolio(http('POST','token-c',{request_id:lostId}));assert.equal(retry.status,200);assert.equal((await retry.json()).replayed,true);
    });
    await t.test('P/L ženklai, chronologija ir puslapiavimas',async()=>{
      // Imitaciniai duomenys egzistuoja tik vietinėje atminties DB.
      await db.exec(`insert into snapshots(user_id,captured_at,cash_balance,holdings_value) values
        ('${b}',clock_timestamp()-interval '2 days',10000,25),('${b}',clock_timestamp()-interval '1 day',9990,0);`);
      const all=await portfolio(http('GET','token-b'));assert.deepEqual((await all.json()).points.map(p=>p.total_profit_loss),['25.00','-10.00','0.00']);
      assert.equal((await (await portfolio(http('GET','token-b',null,'?limit=2'))).json()).has_more,true);
    });
    await t.test('002 ir 005 dalijasi užklausų tarpu, pauze ir 25 užklausų limitu',async()=>{
      assert.equal((await backend.store.reserve('MSFT')).action,'throttled');await db.exec("update av_api_control set next_request_at='-infinity';");
      const q=await backend.store.reserve('MSFT');assert.equal(q.action,'fetch');await backend.store.finish('MSFT',q.lease,null);
      assert.equal((await db.query('select count(*)::int as n from av_api_requests')).rows[0].n,2);
      await db.exec("update av_api_control set next_request_at='-infinity';");const h=await chart.priceStore.reserve('AMD');assert.equal(h.action,'fetch');
      await chart.priceStore.finish('AMD',h.lease,null,true);assert.equal((await backend.store.reserve('NVDA')).action,'quota');
      await db.exec("update av_api_control set paused_until='-infinity',next_request_at='-infinity';delete from av_api_requests;insert into av_api_requests(requested_at) select clock_timestamp() from generate_series(1,25);");
      assert.equal((await backend.store.reserve('IBM')).action,'quota');assert.equal((await chart.priceStore.reserve('IBM')).action,'quota');
      const before=providerCalls;assert.equal((await price(http('GET','token-a',null,'?symbol=IBM'))).status,429);assert.equal(providerCalls,before);
    });
    await t.test('Nepilnas taškas neįrašomas; finansiniai duomenys nepakeisti',async()=>{
      await db.exec(`update snapshots set captured_at=clock_timestamp()-interval '2 minutes' where user_id='${a}';update av_quote_cache set fetched_at=clock_timestamp()-interval '2 days' where symbol='AAPL';`);
      const before=providerCalls;const response=await portfolio(http('POST','token-a',{request_id:'40000000-0000-4000-8000-000000000004'}));assert.equal(response.status,409);assert.equal(providerCalls,before);
      assert.equal((await db.query('select count(*)::int as n from snapshots where user_id=$1',[a])).rows[0].n,1);
      assert.equal((await db.query('select count(*)::int as n from transactions')).rows[0].n,0);
      assert.equal((await db.query('select cash_balance::text as cash from profiles where id=$1',[a])).rows[0].cash,'9657.06');
    });
  } finally { await db.close(); }
});
