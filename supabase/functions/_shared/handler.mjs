import { ApiError, fetchQuote, validateQuote, validateSymbol } from './quotes.mjs';
import { describeQuote } from './freshness.mjs';

// Priklausomybės perduodamos atskirai, todėl testai nenaudoja tikro API ar DB.
export function createHandler({ authenticate, store, apiKey, origins, fetcher = fetch,
  now = () => new Date() }) {
  const allowedOrigins = new Set(origins);
  return async function handle(request) {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && allowedOrigins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    }
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
    let reservation;
    let symbol;
    try {
      if (origin && !allowedOrigins.has(origin)) {
        throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'Ši svetainė neturi prieigos.');
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'GET') {
        headers.Allow = 'GET, OPTIONS';
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Naudokite GET metodą.');
      }
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!token || !await authenticate(token)) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Būtina prisijungti.');
      }
      const params = new URL(request.url).searchParams;
      if (params.getAll('symbol').length !== 1 ||
          [...params.keys()].some(key => key !== 'symbol')) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Pateikite vieną symbol parametrą.');
      }
      symbol = validateSymbol(params.get('symbol'));
      if (!apiKey?.trim()) throw new ApiError(503, 'NOT_CONFIGURED', 'Kainų API nesukonfigūruota.');
      reservation = await store.reserve(symbol);
      const cached = (fallback) => {
        if (!reservation.quote) return null;
        try {
          return describeQuote(validateQuote(reservation.quote, symbol, now()), {
            fetchedAt: reservation.quote.fetched_at, cached: true, fallback, now: now(),
          });
        } catch { return null; }
      };
      if (reservation.action === 'cache') {
        const quote = cached(false);
        if (!quote) throw new ApiError(502, 'INVALID_QUOTE', 'Talpyklos kaina nebetinkama.');
        return json(200, quote);
      }
      if (reservation.action !== 'fetch') {
        const quote = cached(true);
        if (quote) return json(200, { ...quote, warning: quote.warning + ' Atnaujinimas negalimas; rodoma talpyklos dienos kaina.' });
        const busy = reservation.action === 'busy';
        throw new ApiError(busy ? 503 : 429, busy ? 'REFRESH_IN_PROGRESS' : 'QUOTE_LIMIT',
          busy ? 'Kaina atnaujinama. Bandykite vėliau.' : 'Kainų užklausų limitas. Bandykite vėliau.');
      }
      const quote = await fetchQuote(symbol, apiKey, fetcher, now());
      // Nesėkmingas tiekėjo atnaujinimas neturi pakeisti naujesnės turimos kainos.
      if (reservation.quote?.trading_date > quote.trading_date) {
        throw new ApiError(502, 'QUOTE_DATE_REGRESSION', 'Tiekėjas grąžino senesnę kainos datą.');
      }
      const fetchedAt = now().toISOString();
      await store.finish(symbol, reservation.lease, quote);
      return json(200, describeQuote(quote, {
        fetchedAt, cached: false, now: now(),
      }));
    } catch (error) {
      if (reservation?.action === 'fetch') {
        try {
          await store.finish(symbol, reservation.lease, null, error?.code === 'PROVIDER_LIMIT');
        } catch { /* Užraktas vis tiek baigs galioti automatiškai. */ }
        // Senesnė dienos kaina pateikiama tik aiškiai pažymėta ir ne senesnė nei 7 dienos.
        if (reservation.quote) {
          try {
            const quote = validateQuote(reservation.quote, symbol, now());
            return json(200, describeQuote(quote, {
              fetchedAt: reservation.quote.fetched_at, cached: true, fallback: true, now: now(),
              warning: 'Atnaujinti nepavyko; rodoma talpyklos dienos kaina.',
            }));
          } catch { /* Netinkama sena kaina negrąžinama. */ }
        }
      }
      const known = error instanceof ApiError;
      return json(known ? error.status : 503, { error: {
        code: known ? error.code : 'SERVICE_UNAVAILABLE',
        message: known ? error.message : 'Kainų paslauga laikinai nepasiekiama.',
      } });
    }
  };
}