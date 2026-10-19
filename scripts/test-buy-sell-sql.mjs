// Tik vietinė, atmintyje veikianti PostgreSQL bazė. Tinklo / Supabase ryšio nėra.
// PGlite modulio kelias perduodamas argumentu; projekto priklausomybių nekeičia.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTradeSqlScenarios } from '../supabase/functions/tests/trade-sql-scenarios.mjs';
import { expectedTradingDate } from '../supabase/functions/_shared/freshness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const modulePath = process.argv[2];
if (!modulePath) {
  console.error('Nurodykite vietinio PGlite dist/index.js kelią. Žr. docs/BUY_SELL_DATABASE.md.');
  process.exit(1);
}
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
try {
  // Supabase Auth imituojama tik šiame atminties egzemplioriuje.
  // Tai NETIKRINA tikro JWT parašo ar Supabase vartotojo sesijos.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    -- Supabase gali suteikti plačias numatytąsias teises: 003 privalo jas apriboti.
    alter default privileges in schema public grant all on tables to service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (
      id uuid primary key, email text, aud text, role text,
      created_at timestamptz, updated_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    $$;
  `);
  for (const name of ['001_initial_schema.sql', '002_alpha_vantage_cache.sql']) {
    await db.exec(await readFile(resolve(root, 'supabase/migrations', name), 'utf8'));
    console.log('Pritaikyta tik vietinėje atmintyje: ' + name);
  }
  // Patikrinama, kad 003 nesugadina prieš ją buvusio sandorio metaduomenų.
  await db.exec(`
    insert into auth.users(id, email) values
      ('d0000000-0000-4000-8000-000000000001', 'legacy@example.invalid');
    insert into public.transactions(user_id, request_id, symbol, side, quantity, price, quote_at)
      values ('d0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'IBM', 'buy', 1, 1, now());
  `);
  await db.exec(await readFile(resolve(root, 'supabase/migrations/003_buy_sell.sql'), 'utf8'));
  const legacy = await db.query(`
    select quote_at is not null and quote_trading_date is null
      and quote_fetched_at is null and quote_source is null and quote_price is null as preserved
    from public.transactions
  `);
  assert.equal(legacy.rows[0].preserved, true);
  console.log('003 suderinamumas su 001, 002 ir senu sandoriu: praėjo');

  const calendar = await db.query(`
    select d::text as instant, trading_private.expected_trading_date(d)::text as expected
    from generate_series('2026-01-01 00:00Z'::timestamptz,
      '2028-12-31 23:00Z'::timestamptz, interval '6 hours') as t(d)
  `);
  for (const row of calendar.rows) {
    assert.equal(row.expected, expectedTradingDate(new Date(row.instant)), row.instant);
  }
  console.log('SQL ir JavaScript kalendorių sutapimas: ' + calendar.rows.length + ' atvejai');

  const results = await db.exec(await readFile(resolve(root, 'supabase/tests/003_buy_sell.test.sql'), 'utf8'));
  const summary = results.find(result => result.rows?.[0]?.passed_assertions !== undefined);
  assert.ok(summary);
  console.log('SQL scenarijai: ' + summary.rows[0].passed_assertions + ' patikros praėjo');

  const roundingResults = await db.exec(await readFile(
    resolve(root, 'supabase/tests/003_buy_sell_rounding.test.sql'), 'utf8'));
  const roundingSummary = roundingResults.find(result =>
    result.rows?.[0]?.rounding_assertions !== undefined);
  assert.ok(roundingSummary);
  console.log('Apvalinimo regresiniai scenarijai: ' +
    roundingSummary.rows[0].rounding_assertions + ' patikros praėjo');

  const apiChecks = await runTradeSqlScenarios(db);
  console.log('trade HTTP ir SQL integracija: ' + apiChecks + ' patikros praėjo');

  const after = await db.query(`
    select (select count(*) from auth.users) = 1
      and (select count(*) from public.profiles) = 1
      and (select count(*) from public.positions) = 0
      and (select count(*) from public.transactions) = 1
      and (select count(*) from public.av_quote_cache) = 0
      and not exists (select 1 from pg_trigger where tgname = 'buy_sell_test_failure')
      as rolled_back
  `);
  assert.equal(after.rows[0].rolled_back, true);
  console.log('Testų ROLLBACK ir laikino trigerio pašalinimas: praėjo');
  console.log('Supabase nenaudotas. Kelių tikrų sesijų lygiagretumas čia nepatikrintas.');
} finally {
  await db.close();
}