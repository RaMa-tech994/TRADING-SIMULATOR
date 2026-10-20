import { ApiError, validateSymbol } from './quotes.mjs';
import { describeQuote } from './freshness.mjs';

const invalid = () => new ApiError(502, 'INVALID_HISTORY', 'Tiekėjas nepateikė tinkamos dienos kainų istorijos.');
export function validatePricePoints(points, now = new Date()) {
  if (!Array.isArray(points) || points.length < 1 || points.length > 100) throw invalid();
  let previous = '';
  return points.map(point => {
    const date = point?.date, close = point?.close;
    const parsed = new Date(date + 'T00:00:00Z');
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000') ||
        !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
        date > now.toISOString().slice(0, 10) || date <= previous ||
        typeof close !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(close) ||
        !Number.isFinite(Number(close)) || Number(close) <= 0 || Number(close) >= 1e12) throw invalid();
    previous = date;
    return { date, close };
  });
}

export async function fetchPriceHistory(symbol, apiKey, fetcher = fetch, now = new Date()) {
  const url = new URL('https://www.alphavantage.co/query');
  url.search = new URLSearchParams({ function: 'TIME_SERIES_DAILY', symbol, outputsize: 'compact', apikey: apiKey, datatype: 'json' }).toString();
  let body;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (response.status === 429) throw new ApiError(429, 'PROVIDER_LIMIT', 'Kainų tiekėjo limitas pasiektas.');
    if (!response.ok) throw Error('HTTP');
    body = await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Kainų istorijos tiekėjas nepasiekiamas.');
  }
  if (body?.Note || (body?.Information && /rate|limit|frequency|25 requests/i.test(String(body.Information)))) {
    throw new ApiError(429, 'PROVIDER_LIMIT', 'Kainų tiekėjo limitas pasiektas.');
  }
  if (body?.Information || body?.['Error Message']) throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Kainų istorijos gauti nepavyko.');
  const series = body?.['Time Series (Daily)'];
  if (body?.['Meta Data']?.['2. Symbol'] !== symbol || !series || typeof series !== 'object' || Array.isArray(series)) throw invalid();
  const points = Object.keys(series).sort().map(date => ({ date, close: series[date]?.['4. close'] }));
  return validatePricePoints(points, now);
}

function describeHistory(history, symbol, { cached, fallback = false, now }) {
  if (history?.symbol !== symbol) throw invalid();
  const points = validatePricePoints(history.points, now);
  const last = points.at(-1);
  if (history.latest_trading_date !== last.date) throw invalid();
  const freshness = describeQuote({ symbol, price: last.close, trading_date: last.date }, {
    fetchedAt: history.fetched_at, cached, fallback, now,
  });
  return { symbol, currency: 'USD', source: 'Alpha Vantage', data_type: 'daily_close', adjusted: false,
    is_realtime: false, points, latest_trading_date: last.date, fetched_at: history.fetched_at,
    cached, cache_fresh: freshness.cache_fresh, price_freshness: freshness.price_freshness,
    expected_trading_date: freshness.expected_trading_date, possibly_stale: freshness.possibly_stale,
    stale: freshness.stale, warning: freshness.warning };
}

export function createPriceHistoryService({ store, apiKey, fetcher = fetch, now = () => new Date() }) {
  return async value => {
    const symbol = validateSymbol(value);
    if (!apiKey?.trim()) throw new ApiError(503, 'NOT_CONFIGURED', 'Kainų istorijos API nesukonfigūruota.');
    let reservation;
    const cached = fallback => {
      try { return describeHistory(reservation.history, symbol, { cached: true, fallback, now: now() }); }
      catch { return null; }
    };
    try {
      reservation = await store.reserve(symbol);
      if (reservation?.action === 'cache') {
        const history = cached(false);
        if (!history) throw invalid();
        return history;
      }
      if (reservation?.action !== 'fetch') {
        const history = cached(true);
        if (history) return history;
        if (reservation?.action === 'busy') throw new ApiError(503, 'REFRESH_IN_PROGRESS', 'Istorija atnaujinama. Bandykite vėliau.');
        throw new ApiError(429, 'HISTORY_LIMIT', 'Bendras kainų API limitas arba užklausų tarpas. Bandykite vėliau.');
      }
      const points = await fetchPriceHistory(symbol, apiKey, fetcher, now());
      const last = points.at(-1).date;
      if (reservation.history?.latest_trading_date > last ||
          Date.parse(now().toISOString().slice(0, 10)) - Date.parse(last) > 7 * 86400000) throw invalid();
      await store.finish(symbol, reservation.lease, points);
      return describeHistory({ symbol, points, latest_trading_date: last, fetched_at: now().toISOString() }, symbol,
        { cached: false, now: now() });
    } catch (error) {
      if (reservation?.action === 'fetch') {
        try { await store.finish(symbol, reservation.lease, null, error?.code === 'PROVIDER_LIMIT'); } catch { /* Lease baigs galioti savaime. */ }
        const history = cached(true);
        if (history) return history;
      }
      throw error;
    }
  };
}
