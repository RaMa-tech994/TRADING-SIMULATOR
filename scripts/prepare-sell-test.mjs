import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Tik pasiruošimas: šiame faile nėra trade arba sell_stock kvietimo.
export async function prepareSellTest(client, now) {
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || !identity?.user?.id) throw new Error('Prisijungimo patvirtinti nepavyko.');
  const id = identity.user.id;
  const [{ data: profile, error: profileError }, { data: position, error: positionError }] = await Promise.all([
    client.from('profiles').select('cash_balance').eq('id', id).maybeSingle(),
    client.from('positions').select('quantity, average_cost').eq('user_id', id).eq('symbol', 'AAPL').maybeSingle(),
  ]);
  if (profileError || positionError || !profile || !position || !Number.isSafeInteger(position.quantity) || position.quantity < 1 ||
      profile.cash_balance === null || !Number.isFinite(Number(profile.cash_balance)) || Number(profile.cash_balance) < 0) {
    throw new Error('Nepavyko patvirtinti balanso arba neturite bent 1 AAPL akcijos.');
  }
  const { data: quote, error: quoteError } = await client.functions.invoke('get-quote?symbol=AAPL', { method: 'GET' });
  const age = (now ?? Date.now()) - Date.parse(quote?.fetched_at);
  if (quoteError || quote?.symbol !== 'AAPL' || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0 ||
      quote.cache_fresh !== true || quote.price_freshness !== 'recent_daily' ||
      quote.possibly_stale !== false || quote.stale !== false || quote.is_realtime !== false ||
      !/^\d{4}-\d{2}-\d{2}$/.test(quote.trading_date ?? '') || !(age >= 0 && age < 86400000)) {
    throw new Error('Kainos tinkamumas nepatvirtintas. Pardavimo ruošti negalima.');
  }
  return { balance: profile.cash_balance, quantity: position.quantity, average_cost: position.average_cost,
    price: quote.price, trading_date: quote.trading_date,
    order: { symbol: 'AAPL', side: 'SELL', quantity: 1, request_id: randomUUID() } };
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Paleiskite interaktyviame Cursor PowerShell terminale.');
  }
  let local = {};
  try { local = parseEnv(readFileSync('.env.local', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Nepavyko perskaityti .env.local.'); }
  const url = process.env.VITE_SUPABASE_URL || local.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || local.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url?.startsWith('https://') || !key?.startsWith('sb_publishable_')) {
    throw new Error('Reikia VITE_SUPABASE_URL ir viešo VITE_SUPABASE_PUBLISHABLE_KEY. Reikšmių nerodykite.');
  }
  const client = createClient(url, key, { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  } });
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) {
    if (!muted) process.stdout.write(chunk, encoding);
    done();
  } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  let email, password;
  try {
    email = await terminal.question('Jūsų vartotojo el. paštas: ');
    process.stdout.write('Slaptažodis (įvedimas nerodomas): ');
    muted = true;
    password = await terminal.question('');
  } finally { muted = false; terminal.close(); process.stdout.write('\n'); }
  try {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    password = undefined;
    if (error) throw new Error('Prisijungti nepavyko. Patikrinkite duomenis ir el. pašto patvirtinimą.');
    const result = await prepareSellTest(client);
    console.info('Patikra sėkminga. SELL NEVYKDYTAS.');
    console.info('Balansas USD:', result.balance);
    console.info('AAPL kiekis:', result.quantity, 'Vidutinė savikaina USD:', result.average_cost);
    console.info('Dienos kaina USD:', result.price, 'Prekybos data:', result.trading_date);
    console.info('Tai ne realaus laiko kaina. Galutinę kainą patikrins pardavimo SQL funkcija.');
    console.info('Paruoštas, bet NEIŠSIŲSTAS pavedimas:', JSON.stringify(result.order));
  } finally { password = undefined; client.auth.stopAutoRefresh(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Išorinės klaidos ir jų objektai neišvedami: juose gali būti prisijungimo informacijos.
    const safe = ['Paleiskite interaktyviame Cursor PowerShell terminale.',
      'Nepavyko perskaityti .env.local.',
      'Reikia VITE_SUPABASE_URL ir viešo VITE_SUPABASE_PUBLISHABLE_KEY. Reikšmių nerodykite.',
      'Prisijungti nepavyko. Patikrinkite duomenis ir el. pašto patvirtinimą.',
      'Prisijungimo patvirtinti nepavyko.',
      'Nepavyko patvirtinti balanso arba neturite bent 1 AAPL akcijos.',
      'Kainos tinkamumas nepatvirtintas. Pardavimo ruošti negalima.'];
    console.info(safe.includes(error.message) ? error.message : 'Patikra nepavyko. Slapta informacija nerodoma.');
    process.exitCode = 1;
  });
}
