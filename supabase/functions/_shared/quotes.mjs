// Šis modulis naudojamas tik serverio funkcijoje ir vietiniuose testuose.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const SYMBOLS = new Set([
  'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META',
  'NVDA', 'TSLA', 'IBM', 'NFLX', 'AMD',
]);

export function validateSymbol(value) {
  const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{1,5}$/.test(symbol) || !SYMBOLS.has(symbol)) {
    throw new ApiError(400, 'INVALID_SYMBOL', 'Pasirinkite vieną iš palaikomų JAV akcijų.');
  }
  return symbol;
}

export function validateQuote(quote, symbol, now = new Date()) {
  const price = String(quote?.price ?? '');
  const date = quote?.trading_date;
  const parsed = new Date(date + 'T00:00:00Z');
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (quote?.symbol !== symbol ||
      !/^\d+(\.\d{1,6})?$/.test(price) ||
      !Number.isFinite(Number(price)) || Number(price) <= 0 ||
      Number(price) >= 1e12 ||
      typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
      parsed.getTime() > today || today - parsed.getTime() > 7 * 86400000) {
    throw new ApiError(502, 'INVALID_QUOTE', 'Kainų tiekėjas nepateikė tinkamos dienos kainos.');
  }
  // Kaina grąžinama dešimtaine eilute, o ne naudojama pinigų aritmetikai JS.
  return { symbol, price, trading_date: date, source: 'Alpha Vantage', data_type: 'end_of_day' };
}

export async function fetchQuote(symbol, apiKey, fetcher = fetch, now = new Date()) {
  const url = new URL('https://www.alphavantage.co/query');
  url.search = new URLSearchParams({
    function: 'GLOBAL_QUOTE', symbol, apikey: apiKey, datatype: 'json',
  }).toString();
  let response;
  let body;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (response.status === 429) {
      throw new ApiError(429, 'PROVIDER_LIMIT', 'Pasiektas kainų tiekėjo užklausų limitas.');
    }
    if (!response.ok) throw new Error('Tiekėjo HTTP klaida');
    body = await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Į atsakymą ar žurnalą nepatenka URL, API raktas ar žalias tiekėjo tekstas.
    throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Kainų tiekėjas laikinai nepasiekiamas.');
  }
  if (body?.Note || (body?.Information &&
      /rate|limit|frequency|25 requests/i.test(String(body.Information)))) {
    throw new ApiError(429, 'PROVIDER_LIMIT', 'Pasiektas kainų tiekėjo užklausų limitas.');
  }
  if (body?.Information || body?.['Error Message']) {
    throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Kainų tiekėjas užklausos neįvykdė.');
  }
  const raw = body?.['Global Quote'];
  return validateQuote({
    symbol: raw?.['01. symbol'],
    price: raw?.['05. price'],
    trading_date: raw?.['07. latest trading day'],
  }, symbol, now);
}