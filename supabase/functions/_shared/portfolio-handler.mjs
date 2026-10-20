import { ApiError } from './quotes.mjs';
import { valuePortfolio } from './portfolio.mjs';

export function createPortfolioHandler({ getUser, readPortfolio, getQuote, origins = [], now }) {
  const allowed = new Set(origins);
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && allowed.has(origin)) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-retry-count, traceparent, tracestate, baggage',
    });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
    try {
      if (origin && !allowed.has(origin)) throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'Svetainė neturi prieigos.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'GET') { headers.Allow = 'GET, OPTIONS'; throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Naudokite GET.'); }
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      const user = token ? await getUser(token) : null;
      if (!user || user.role !== 'authenticated' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id ?? '')) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Būtina prisijungti.');
      }
      if (new URL(request.url).search) throw new ApiError(400, 'INVALID_REQUEST', 'Papildomi parametrai neleidžiami.');
      const snapshot = await readPortfolio(token, user.id);
      return json(200, await valuePortfolio(snapshot, getQuote, now));
    } catch (error) {
      const known = error instanceof ApiError;
      return json(known ? error.status : 503, { error: { code: known ? error.code : 'PORTFOLIO_UNAVAILABLE',
        message: known ? error.message : 'Portfelio paslauga nepasiekiama.' } });
    }
  };
}
