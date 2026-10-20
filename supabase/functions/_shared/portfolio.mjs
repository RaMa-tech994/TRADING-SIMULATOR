import { ApiError, validateQuote } from './quotes.mjs';
import { describeQuote } from './freshness.mjs';

const SCALE = 1000000n;
function decimal(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new ApiError(503, 'INVALID_PORTFOLIO', 'Portfelio duomenys netinkami.');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
// Teigiamoms ir neigiamoms sumoms pusė cento apvalinama nuo nulio.
function cents(micros) {
  return micros < 0n ? -((-micros + 5000n) / 10000n) : (micros + 5000n) / 10000n;
}
function money(value) {
  const n = value < 0n ? -value : value;
  return (value < 0n ? '-' : '') + (n / 100n) + '.' + String(n % 100n).padStart(2, '0');
}

export async function valuePortfolio(snapshot, getQuote, now = () => new Date()) {
  const cash = decimal(snapshot.cash_balance);
  if (cash % 10000n !== 0n || !Array.isArray(snapshot.positions)) {
    throw new ApiError(503, 'INVALID_PORTFOLIO', 'Portfelio duomenys netinkami.');
  }
  const seen = new Set();
  const validated = snapshot.positions.map(position => {
    const quantity = Number(position.quantity);
    const cost = decimal(position.average_cost);
    if (typeof position.symbol !== 'string' || !position.symbol || seen.has(position.symbol) ||
        !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647 || cost <= 0n) {
      throw new ApiError(503, 'INVALID_PORTFOLIO', 'Portfelio duomenys netinkami.');
    }
    seen.add(position.symbol);
    return { ...position, quantity, cost };
  });
  const positions = [];
  let holdings = 0n, profit = 0n;
  for (const position of validated) {
    const row = { symbol: position.symbol, quantity: position.quantity, average_cost: position.average_cost,
      current_price: null, trading_date: null, fetched_at: null, source: null,
      market_value: null, unrealized_profit_loss: null, valuation_status: 'unavailable',
      price_freshness: null, possibly_stale: true, cache_fresh: false, issue: null };
    try {
      const quote = await getQuote(position.symbol);
      const checked = validateQuote(quote, position.symbol, now());
      const freshness = describeQuote(checked, { fetchedAt: quote.fetched_at,
        cached: Boolean(quote.cached), fallback: quote.possibly_stale === true || quote.stale === true, now: now() });
      Object.assign(row, { current_price: checked.price, trading_date: checked.trading_date,
        fetched_at: quote.fetched_at, source: checked.source, price_freshness: freshness.price_freshness,
        possibly_stale: freshness.possibly_stale, cache_fresh: freshness.cache_fresh });
      if (!freshness.cache_fresh || freshness.possibly_stale || quote.is_realtime !== false) {
        row.valuation_status = 'outdated_or_unverified';
        row.issue = 'Kaina pasenusi arba jos aktualumas nepatvirtintas; vertė neskaičiuojama.';
      } else {
        const price = decimal(checked.price), quantity = BigInt(position.quantity);
        const value = cents(price * quantity);
        const gain = cents((price - position.cost) * quantity);
        holdings += value; profit += gain;
        Object.assign(row, { market_value: money(value), unrealized_profit_loss: money(gain),
          valuation_status: 'valued' });
      }
    } catch {
      row.issue = 'Tinkama akcijos kaina neprieinama; vertė neskaičiuojama.';
    }
    positions.push(row);
  }
  const missing = positions.filter(p => p.valuation_status !== 'valued').map(p => p.symbol);
  const complete = missing.length === 0;
  return { currency: 'USD', data_type: 'end_of_day', is_realtime: false,
    snapshot_at: snapshot.snapshot_at, valued_at: now().toISOString(),
    valuation_complete: complete, missing_symbols: missing, cash_balance: money(cash / 10000n), positions,
    valued_positions_market_value: money(holdings),
    holdings_market_value: complete ? money(holdings) : null,
    total_portfolio_value: complete ? money(cash / 10000n + holdings) : null,
    total_unrealized_profit_loss: complete ? money(profit) : null,
    warning: 'Vertinimas pagal dienos kainas, ne realaus laiko duomenis. Trūkstant tinkamų kainų bendros vertės nepateikiamos.' };
}
