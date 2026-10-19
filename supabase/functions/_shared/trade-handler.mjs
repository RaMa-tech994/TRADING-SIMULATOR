import { ApiError } from './quotes.mjs';
import { readTradeBody, UUID_PATTERN, validateTrade } from './trade-validation.mjs';
import { unknownTradeOutcome } from './trade-errors.mjs';

const REFRESHABLE = new Set(['QUOTE_UNAVAILABLE', 'QUOTE_CACHE_EXPIRED', 'QUOTE_STALE']);
const decimal = value => typeof value === 'string' &&
  /^\d+(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);

function tradeResponse(result, order, user) {
  const tx = result?.transaction;
  const quantity = Number(tx?.quantity);
  // Patikrinama, kad atsakyta apie tikrąjį JWT vartotoją ir tą patį pavedimą.
  if (typeof result?.replayed !== 'boolean' || !UUID_PATTERN.test(tx?.id ?? '') ||
      tx?.user_id !== user.id || tx?.request_id !== order.request_id ||
      tx?.symbol !== order.symbol || tx?.side !== order.side || quantity !== order.quantity ||
      !decimal(tx?.price) || !decimal(tx?.total_amount) ||
      (tx?.quote_price !== null && !decimal(tx?.quote_price)) ||
      typeof tx?.executed_at !== 'string' || !Number.isFinite(Date.parse(tx.executed_at)) ||
      (tx?.quote_trading_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(tx?.quote_trading_date ?? ''))) {
    throw unknownTradeOutcome();
  }
  return {
    success: true, request_id: order.request_id, replayed: result.replayed,
    transaction: {
      id: tx.id, request_id: tx.request_id, symbol: tx.symbol, side: tx.side, quantity,
      price: tx.price, total_amount: tx.total_amount, quote_price: tx.quote_price,
      quote_trading_date: tx.quote_trading_date, quote_fetched_at: tx.quote_fetched_at,
      quote_source: tx.quote_source, quote_at: tx.quote_at, executed_at: tx.executed_at,
    },
    currency: 'USD', data_type: tx.quote_trading_date ? 'end_of_day' : 'historical_trade',
    is_realtime: false,
    warning: tx.quote_trading_date
      ? 'Virtualus sandoris pagal išsaugotą dienos kainą. Vieneto vykdymo kaina suapvalinta DB iki centų; tai ne realaus laiko kotiruotė.'
      : 'Istorinis virtualus sandoris: grąžinti originalūs duomenys, naujas apvalinimas netaikomas; tai ne realaus laiko kotiruotė.',
  };
}

export function createTradeHandler({ getUser, executeTrade, getQuote, origins }) {
  const allowedOrigins = new Set(origins);
  return async function handle(request) {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && allowedOrigins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers });
    let order;
    try {
      if (origin && !allowedOrigins.has(origin)) {
        throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'Ši svetainė neturi prieigos.');
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') {
        headers.Allow = 'POST, OPTIONS';
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Naudokite POST metodą.');
      }
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      const user = token ? await getUser(token) : null;
      if (!user || !UUID_PATTERN.test(user.id ?? '') || user.role !== 'authenticated') {
        throw new ApiError(401, 'UNAUTHORIZED', 'Būtina galiojanti vartotojo prisijungimo sesija.');
      }
      if (new URL(request.url).search) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Pavedimo parametrus pateikite tik JSON turinyje.');
      }
      order = validateTrade(await readTradeBody(request));
      let result;
      try {
        // SQL pirmiausia patikrina request_id. Pakartojimas neveikia kainų kvotos.
        // Naują pavedimą SQL gali iškart vykdyti pagal jau tinkamą serverio talpyklą.
        result = await executeTrade(token, order);
      } catch (error) {
        // Tinklo klaidų ir neaiškios baigties pavedimų automatiškai NEKARTOJAME.
        if (!(error instanceof ApiError) || !REFRESHABLE.has(error.code)) throw error;
        const quote = await getQuote(order.symbol);
        if (quote?.symbol !== order.symbol) {
          throw new ApiError(502, 'INVALID_QUOTE', 'Nepavyko patvirtinti akcijos kainos.');
        }
        if (quote.price_freshness === 'unverified') {
          throw new ApiError(503, 'QUOTE_UNVERIFIED', 'Kainos aktualumas nepatvirtintas.');
        }
        if (!quote.cache_fresh || quote.price_freshness !== 'recent_daily' ||
            quote.possibly_stale || quote.stale || quote.is_realtime !== false) {
          throw new ApiError(409, 'QUOTE_STALE', 'Sandoriui tinkamos dienos kainos gauti nepavyko.');
        }
        // Tai vienintelis pakartojimas po aiškiai atmestos (neįvykdytos) operacijos.
        // Kaina neperduodama: SQL ją iš naujo skaito ir tikrina laikydama užraktą.
        result = await executeTrade(token, order);
      }
      const response = tradeResponse(result, order, user);
      return json(response.replayed ? 200 : 201, response);
    } catch (error) {
      const known = error instanceof ApiError;
      const retry = known && ['TRADE_STATUS_UNKNOWN', 'TRADE_RETRY'].includes(error.code);
      return json(known ? error.status : 503, { error: {
        code: known ? error.code : 'TRADE_UNAVAILABLE',
        message: known ? error.message : 'Prekybos paslauga laikinai nepasiekiama.',
        ...(order ? { request_id: order.request_id } : {}),
        ...(retry ? { retry_with_same_request_id: true } : {}),
      } });
    }
  };
}