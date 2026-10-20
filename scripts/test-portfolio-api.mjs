import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

function micros(value, signed = false) {
  if (typeof value !== 'string' || !(signed ? /^-?\d+(?:\.\d{1,6})?$/ : /^\d+(?:\.\d{1,6})?$/).test(value)) throw Error('INVALID_NUMBER');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  return negative ? -result : result;
}
const roundCent = value => value < 0n ? -((-value + 5000n) / 10000n) : (value + 5000n) / 10000n;
function moneyCents(value, signed = false) {
  if (typeof value !== 'string' || !(signed ? /^-?\d+\.\d{2}$/ : /^\d+\.\d{2}$/).test(value)) throw Error('INVALID_MONEY');
  return micros(value, signed) / 10000n;
}

export function checkPortfolioResponse(data) {
  const errors = [];
  try {
    if (!data || data.currency !== 'USD' || data.is_realtime !== false || data.data_type !== 'end_of_day' ||
        typeof data.valuation_complete !== 'boolean' || !Array.isArray(data.positions) ||
        !Array.isArray(data.missing_symbols)) throw Error('INVALID_FORMAT');
    for (const field of ['snapshot_at', 'valued_at']) {
      if (typeof data[field] !== 'string' || !Number.isFinite(Date.parse(data[field]))) throw Error('INVALID_TIME');
    }
    const cash = moneyCents(data.cash_balance);
    let holdings = 0n, gain = 0n;
    const seen = new Set(), missing = [];
    for (const row of data.positions) {
      if (!row || !/^[A-Z]{1,32}$/.test(row.symbol) || seen.has(row.symbol) ||
          !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 2147483647 || micros(row.average_cost) <= 0n) throw Error('INVALID_POSITION');
      seen.add(row.symbol);
      if (row.valuation_status === 'valued') {
        if (row.possibly_stale !== false || row.cache_fresh !== true || row.price_freshness !== 'recent_daily' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(row.trading_date ?? '') || micros(row.current_price) <= 0n) throw Error('INVALID_QUOTE');
        const value = roundCent(micros(row.current_price) * BigInt(row.quantity));
        const profit = roundCent((micros(row.current_price) - micros(row.average_cost)) * BigInt(row.quantity));
        if (moneyCents(row.market_value) !== value || moneyCents(row.unrealized_profit_loss, true) !== profit) {
          errors.push('Pozicijos vertės arba P/L formulė nesutampa.');
        }
        holdings += value; gain += profit;
      } else {
        if (!['unavailable', 'outdated_or_unverified'].includes(row.valuation_status) ||
            row.market_value !== null || row.unrealized_profit_loss !== null) throw Error('INVALID_PARTIAL');
        missing.push(row.symbol);
      }
    }
    if (data.valuation_complete !== (missing.length === 0) ||
        JSON.stringify([...data.missing_symbols].sort()) !== JSON.stringify([...missing].sort())) throw Error('INVALID_COMPLETENESS');
    if (moneyCents(data.valued_positions_market_value) !== holdings) errors.push('Įvertintų pozicijų suma nesutampa.');
    if (data.valuation_complete) {
      if (moneyCents(data.holdings_market_value) !== holdings || moneyCents(data.total_portfolio_value) !== cash + holdings ||
          moneyCents(data.total_unrealized_profit_loss, true) !== gain) errors.push('Portfelio bendros sumos nesutampa.');
    } else if (data.holdings_market_value !== null || data.total_portfolio_value !== null || data.total_unrealized_profit_loss !== null) {
      errors.push('Nepilno vertinimo bendros sumos turi būti null.');
    }
    return { valid: errors.length === 0, complete: data.valuation_complete, errors };
  } catch { return { valid: false, complete: false, errors: ['API duomenų formatas netinkamas arba trūksta duomenų.'] }; }
}

export async function runPortfolioTest(client) {
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity?.user?.id || identity.user.role !== 'authenticated') throw Error('AUTH_FAILED');
  const { data, error } = await client.functions.invoke('portfolio', { method: 'GET' });
  if (error) return { apiFailed: true, status: Number.isInteger(error.context?.status) ? error.context.status : null };
  const check = checkPortfolioResponse(data);
  if (!check.valid) return { check };
  // Atskiru skaitymu patvirtinama, kad atsakymas atitinka savo vartotojo DB duomenis.
  const { data: own, error: dbError } = await client.rpc('get_portfolio_snapshot');
  if (dbError || !own || own.user_id !== identity.user.id) return { check, ownDataVerified: false, data };
  const normalize = positions => positions.map(p => [p.symbol, Number(p.quantity), micros(p.average_cost).toString()])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const matches = moneyCents(own.cash_balance) === moneyCents(data.cash_balance) &&
    JSON.stringify(normalize(own.positions)) === JSON.stringify(normalize(data.positions));
  return { check, ownDataVerified: matches, data };
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.info('Git Bash naudokite: winpty node scripts/test-portfolio-api.mjs'); return;
  }
  let settings = {};
  for (const file of ['.env', '.env.local']) {
    try { settings = { ...settings, ...parseEnv(readFileSync(file, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const url = process.env.VITE_SUPABASE_URL || settings.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || settings.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || new URL(url).protocol !== 'https:' || !key?.startsWith('sb_publishable_')) {
    console.info('Patikrinkite VITE_SUPABASE_URL ir VITE_SUPABASE_PUBLISHABLE_KEY konfigūraciją. Reikšmių nerodykite.');
    process.exitCode = 1; return;
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let muted = false, password;
  const output = new Writable({ write(chunk, encoding, done) {
    if (!muted) process.stdout.write(chunk, encoding); done();
  } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  try {
    const email = await terminal.question('Supabase vartotojo el. paštas: ');
    process.stdout.write('Slaptažodis (įvedimas nerodomas): ');
    muted = true;
    password = await terminal.question('');
    muted = false; process.stdout.write('\n');
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    password = undefined;
    if (error) { console.info('Prisijungti nepavyko. Patikrinkite prisijungimo duomenis.'); process.exitCode = 1; return; }
    const result = await runPortfolioTest(client);
    if (result.apiFailed) {
      console.info('Portfolio API užklausa nepavyko. HTTP būsena:', result.status ?? 'nepasiekiama');
      process.exitCode = 1; return;
    }
    if (!result.check.valid) {
      console.info('Patikra nepraėjo:', result.check.errors.join(' ')); process.exitCode = 1; return;
    }
    console.info('API formatas ir skaičiavimai teisingi.');
    console.info(result.ownDataVerified ? 'Balansas ir pozicijos sutampa su prisijungusio vartotojo DB įrašais.'
      : 'Savo DB duomenų sutapimo patvirtinti nepavyko arba jie tarp skaitymų pasikeitė.');
    const data = result.data;
    console.info('Balansas USD:', data.cash_balance);
    console.info('Pozicijų skaičius:', data.positions.length);
    for (const row of data.positions) {
      console.info(row.symbol, 'kiekis:', row.quantity, 'savikaina USD:', row.average_cost,
        'rinkos vertė USD:', row.market_value ?? 'neįvertinta', 'P/L USD:', row.unrealized_profit_loss ?? 'neįvertinta');
    }
    console.info('Bendra portfelio vertė USD:', data.total_portfolio_value ?? 'nepilnas vertinimas');
    console.info('Bendras nerealizuotas P/L USD:', data.total_unrealized_profit_loss ?? 'nepilnas vertinimas');
    if (!result.check.complete) console.info('Trūksta tinkamų kainų:', data.missing_symbols.join(', '));
    console.info('Tai dienos kainos. BUY ir SELL nevykdomi.');
    if (!result.check.complete || !result.ownDataVerified) process.exitCode = 1;
  } finally { password = undefined; muted = false; terminal.close(); client.auth.stopAutoRefresh(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.info('Testas sustabdytas. Slapti duomenys nerodomi.'); process.exitCode = 1; });
}
