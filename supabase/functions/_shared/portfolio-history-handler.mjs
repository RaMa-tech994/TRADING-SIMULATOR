import { ApiError } from './quotes.mjs';
import { readTradeBody, UUID_PATTERN } from './trade-validation.mjs';
import { historyHttp, queryParams } from './history-http.mjs';

function timestamp(value) {
  if (value.startsWith('0000') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10) ||
      Number(value.slice(11, 13)) > 23) throw new ApiError(400, 'INVALID_REQUEST', 'Naudokite tikrą UTC ISO datą ir laiką.');
  return value;
}
export function historyRange(request) {
  const params = queryParams(request, ['from', 'to', 'limit']);
  const from = params.has('from') ? timestamp(params.get('from')) : null;
  const to = params.has('to') ? timestamp(params.get('to')) : null;
  const limit = params.has('limit') ? params.get('limit') : '100';
  if (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 500 || (from && to && Date.parse(from) > Date.parse(to))) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Netinkamas laikotarpis arba limit (1–500).');
  }
  return { p_from: from, p_to: to, p_limit: Number(limit) };
}
const cents = value => {
  if (typeof value !== 'string' || !/^-?\d+\.\d{2}$/.test(value)) throw Error('INVALID_MONEY');
  return BigInt(value.replace('.', ''));
};
function validPoint(row) {
  return row && typeof row.captured_at === 'string' && Number.isFinite(Date.parse(row.captured_at)) &&
    cents(row.cash_balance) >= 0n && cents(row.holdings_value) >= 0n &&
    cents(row.portfolio_value) === cents(row.cash_balance) + cents(row.holdings_value) &&
    cents(row.total_profit_loss) === cents(row.portfolio_value) - 1000000n;
}
function checkedHistory(data, limit) {
  try {
    if (data?.currency !== 'USD' || data.initial_balance !== '10000.00' ||
        data.profit_loss_type !== 'total_since_initial_balance' || typeof data.has_more !== 'boolean' ||
        !Array.isArray(data.points) || data.points.length > limit || !data.points.every(validPoint) ||
        data.points.some((p, i) => i > 0 && Date.parse(p.captured_at) < Date.parse(data.points[i - 1].captured_at))) throw Error();
    return data;
  } catch { throw new ApiError(503, 'INVALID_HISTORY', 'Portfelio istorijos atsakymas netinkamas.'); }
}
function checkedCapture(data, requestId) {
  try {
    if (typeof data?.replayed !== 'boolean' || !UUID_PATTERN.test(data.snapshot?.id ?? '') ||
        data.snapshot?.request_id !== requestId || !validPoint(data.snapshot)) throw Error();
    return data;
  } catch { throw new ApiError(503, 'SNAPSHOT_STATUS_UNKNOWN', 'Įrašymo baigtis nepatvirtinta. Kartokite tik su tuo pačiu request_id.'); }
}

export function createPortfolioHistoryHandler({ getUser, list, capture, readPortfolio, getQuote, origins }) {
  return historyHttp({ getUser, origins, methods: ['GET', 'POST'], handle: async ({ request, token, user }) => {
    if (request.method === 'GET') {
      const range = historyRange(request);
      return { body: checkedHistory(await list(token, range), range.p_limit) };
    }
    queryParams(request, []);
    const body = await readTradeBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !Object.hasOwn(body, 'request_id') || typeof body.request_id !== 'string' || !UUID_PATTERN.test(body.request_id)) {
      throw new ApiError(400, 'INVALID_REQUEST', 'Pateikite tik UUID request_id.');
    }
    const requestId = body.request_id.toLowerCase();
    try {
      let data;
      try {
        // SQL pirmiausia grąžina jau įrašyto ID rezultatą, be kainų kvotos.
        data = await capture(token, requestId);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'INCOMPLETE_VALUATION') throw error;
        const snapshot = await readPortfolio(token, user.id);
        for (const position of snapshot.positions) {
          const quote = await getQuote(position.symbol);
          if (quote?.symbol !== position.symbol || quote.cache_fresh !== true || quote.price_freshness !== 'recent_daily' ||
              quote.possibly_stale !== false || quote.stale !== false || quote.is_realtime !== false) {
            throw new ApiError(409, 'INCOMPLETE_VALUATION', 'Kainos netinkamos. Istorijos taškas neįrašytas.');
          }
        }
        // Tik vienas kartojimas po aiškiai neįvykusio įrašymo; SQL viską tikrina iš naujo.
        data = await capture(token, requestId);
      }
      const result = checkedCapture(data, requestId);
      return { status: result.replayed ? 200 : 201, body: { success: true, currency: 'USD',
        data_type: 'end_of_day', is_realtime: false, ...result } };
    } catch (error) {
      if (error instanceof ApiError) error.requestId = requestId;
      throw error;
    }
  } });
}
