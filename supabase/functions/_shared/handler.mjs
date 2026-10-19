import { ApiError, validateSymbol } from './quotes.mjs';
import { createQuoteService } from './quote-service.mjs';

// HTTP ir autentifikacija atskirti nuo bendros serverio kainų paslaugos.
export function createHandler({ authenticate, store, apiKey, origins, fetcher = fetch,
  now = () => new Date() }) {
  const allowedOrigins = new Set(origins);
  const getQuote = createQuoteService({ store, apiKey, fetcher, now });
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
      return json(200, await getQuote(validateSymbol(params.get('symbol'))));
    } catch (error) {
      const known = error instanceof ApiError;
      return json(known ? error.status : 503, { error: {
        code: known ? error.code : 'SERVICE_UNAVAILABLE',
        message: known ? error.message : 'Kainų paslauga laikinai nepasiekiama.',
      } });
    }
  };
}