import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PGLITE_MODULE_PATH || join(process.env.TEMP || '/tmp',
  'trading-simulator-sql-tools/node_modules/@electric-sql/pglite/dist/index.js');
test('004: vienas nuoseklus skaitymas, RLS, tikslūs skaičiai ir ribotos teisės',
  { skip: !existsSync(modulePath) ? 'Nėra vietinio PGlite; žr. docs/PORTFOLIO_API.md' : false }, async () => {
    const { PGlite } = await import(pathToFileURL(modulePath).href);
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create schema auth; grant usage on schema auth to anon, authenticated, service_role;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
        create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), ''); $$;
      `);
      for (const file of ['001_initial_schema.sql', '002_alpha_vantage_cache.sql', '003_buy_sell.sql', '004_portfolio_snapshot.sql']) {
        await db.exec(readFileSync(new URL('../../migrations/' + file, import.meta.url), 'utf8'));
      }
      const a = 'a0000000-0000-4000-8000-000000000001', b = 'b0000000-0000-4000-8000-000000000002';
      await db.exec(`
        insert into auth.users values ('${a}'), ('${b}');
        update public.profiles set cash_balance = 9999999999999999.99 where id = '${a}';
        insert into public.positions(user_id, symbol, quantity, average_cost) values
          ('${a}', 'AAPL', 1, 342.940001), ('${b}', 'MSFT', 2, 100);
        set role authenticated;
        set request.jwt.claim.sub = '${a}'; set request.jwt.claim.role = 'authenticated';
      `);
      const row = (await db.query('select public.get_portfolio_snapshot() as data')).rows[0].data;
      assert.equal(row.user_id, a); assert.equal(row.cash_balance, '9999999999999999.99');
      assert.equal(row.positions.length, 1); assert.equal(row.positions[0].symbol, 'AAPL');
      assert.equal(row.positions[0].average_cost, '342.940001');
      await assert.rejects(db.query('update public.profiles set cash_balance=1'));
      await db.exec(`set request.jwt.claim.sub = '${b}';`);
      const other = (await db.query('select public.get_portfolio_snapshot() as data')).rows[0].data;
      assert.equal(other.cash_balance, '10000.00'); assert.equal(other.positions[0].symbol, 'MSFT');
      await db.exec("set request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000003';");
      assert.equal((await db.query('select public.get_portfolio_snapshot() as data')).rows[0].data, null);
      await db.exec("set request.jwt.claim.role = 'anon';");
      assert.equal((await db.query('select public.get_portfolio_snapshot() as data')).rows[0].data, null);
      await db.exec('reset role; set role anon;');
      await assert.rejects(db.query('select public.get_portfolio_snapshot()'));
      await db.exec('reset role; set role service_role;');
      await assert.rejects(db.query('select public.get_portfolio_snapshot()'));
      await db.exec('reset role;');
      const flags = (await db.query("select prosecdef, provolatile from pg_proc where oid='public.get_portfolio_snapshot()'::regprocedure")).rows[0];
      assert.equal(flags.prosecdef, false); assert.equal(flags.provolatile, 's');
    } finally { await db.close(); }
  });
