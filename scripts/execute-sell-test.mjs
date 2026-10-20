import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSellOrder(args = []) {
  let requestId;
  if (args.length === 0) {
    requestId = randomUUID();
  } else if (args.length === 2 && args[0] === '--request-id' && UUID.test(args[1])) {
    requestId = args[1].toLowerCase();
  } else {
    throw new Error('Pakartojimui naudokite --request-id ir galiojantį ankstesnio pavedimo UUID.');
  }
  return Object.freeze({ symbol: 'AAPL', side: 'SELL', quantity: 1, request_id: requestId });
}

// Vienas kvietimas su iš anksto parinktu ID; jokių automatinių pakartojimų.
export async function executeConfirmedSell(client, token, confirmation, order) {
  if (confirmation !== 'PARDUOTI 1 AAPL') return { cancelled: true };
  if (!order || !UUID.test(order.request_id) || order.symbol !== 'AAPL' ||
      order.side !== 'SELL' || order.quantity !== 1) return { invalid: true };
  const body = { symbol: 'AAPL', side: 'SELL', quantity: 1, request_id: order.request_id.toLowerCase() };
  try {
    const { data, error } = await client.functions.invoke('trade', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body,
    });
    const tx = data?.transaction;
    if (error || data?.success !== true || data.request_id !== order.request_id ||
        tx?.request_id !== order.request_id || tx?.symbol !== 'AAPL' ||
        tx?.side !== 'sell' || tx?.quantity !== 1 || typeof tx.price !== 'string' ||
        typeof tx.total_amount !== 'string') return { uncertain: true };
    return { success: true, replayed: data.replayed === true, transaction: {
      id: tx.id, request_id: tx.request_id, symbol: tx.symbol, side: tx.side,
      quantity: tx.quantity, price: tx.price, total_amount: tx.total_amount,
      quote_trading_date: tx.quote_trading_date,
    } };
  } catch { return { uncertain: true }; }
}

async function main() {
  const order = createSellOrder(process.argv.slice(2));
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.info('Naudokite interaktyvų Cursor PowerShell terminalą.'); return;
  }
  let local = {};
  try { local = parseEnv(readFileSync('.env.local', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = process.env.VITE_SUPABASE_URL || local.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || local.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url?.startsWith('https://') || !key?.startsWith('sb_publishable_')) {
    console.info('Trūksta projekto URL arba viešo Publishable key. Reikšmių nerodykite.'); return;
  }
  const client = createClient(url, key, { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  } });
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) {
    if (!muted) process.stdout.write(chunk, encoding); done();
  } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  let password;
  try {
    console.info('Paruoštas SELL: 1 AAPL. request_id:', order.request_id);
    console.info('Išsaugokite šį ID. Neaiškios baigties pavedimą kartokite tik su --request-id ir tuo pačiu UUID.');
    const email = await terminal.question('Jūsų vartotojo el. paštas: ');
    process.stdout.write('Slaptažodis (įvedimas nerodomas): ');
    muted = true;
    password = await terminal.question('');
    muted = false; process.stdout.write('\n');
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    password = undefined;
    if (error || !data?.session?.access_token) {
      console.info('Prisijungti nepavyko. SELL neišsiųstas.'); return;
    }
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError || identity?.user?.id !== data.session.user.id || identity.user.role !== 'authenticated') {
      console.info('Vartotojo patikra nepavyko. SELL neišsiųstas.'); return;
    }
    const token = data.session.access_token;
    const { data: quote, error: quoteError } = await client.functions.invoke('get-quote?symbol=AAPL', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token },
    });
    const age = Date.now() - Date.parse(quote?.fetched_at);
    if (quoteError || quote?.symbol !== 'AAPL' || !Number.isFinite(Number(quote.price)) ||
        Number(quote.price) <= 0 || quote.cache_fresh !== true || quote.price_freshness !== 'recent_daily' ||
        quote.possibly_stale !== false || quote.stale !== false || quote.is_realtime !== false ||
        !(age >= 0 && age < 86400000)) {
      console.info('Kaina pardavimui netinkama. SELL neišsiųstas.'); return;
    }
    console.info('Peržiūros dienos kaina USD:', quote.price, 'Prekybos data:', quote.trading_date);
    console.info('Galutinę kainą ir turimą kiekį patikrins serveris. Tai ne realaus laiko kaina.');
    const confirmation = await terminal.question('Pardavimui patvirtinti įveskite tiksliai PARDUOTI 1 AAPL (kita įvestis atšaukia): ');
    const result = await executeConfirmedSell(client, token, confirmation, order);
    if (result.invalid) { console.info('Pavedimo parametrai netinkami. SELL neišsiųstas.'); return; }
    if (result.cancelled) { console.info('Atšaukta. SELL neišsiųstas.'); return; }
    if (result.uncertain) {
      console.info('Baigtis nepatvirtinta. Automatiškai nekartojama. Patikrinkite transactions pagal ID:', order.request_id);
      console.info('Naujo request_id nekurkite.'); return;
    }
    console.info(result.replayed ? 'Grąžintas ankstesnis SELL, naujas nesukurtas.' : 'SELL sėkmingas.');
    console.info(JSON.stringify(result.transaction, null, 2));
  } finally {
    password = undefined; muted = false; terminal.close(); client.auth.stopAutoRefresh();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.info('Scenarijus sustabdytas. Pakartojimui reikia --request-id ir galiojančio ankstesnio UUID. Jei SELL patvirtinote, tikrinkite istoriją pagal prieš siuntimą parodytą ID.');
    process.exitCode = 1;
  });
}
