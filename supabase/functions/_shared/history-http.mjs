import { ApiError } from './quotes.mjs';
import { UUID_PATTERN } from './trade-validation.mjs';

export function historyHttp({ getUser, origins = [], methods, handle }) {
  const allowed = new Set(origins);
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && allowed.has(origin)) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-retry-count, traceparent, tracestate, baggage',
    });
    try {
      if (origin && !allowed.has(origin)) throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'Svetainė neturi prieigos.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (!methods.includes(request.method)) {
        headers.Allow = [...methods, 'OPTIONS'].join(', ');
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Netinkamas HTTP metodas.');
      }
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
      const user = token ? await getUser(token) : null;
      if (!user || user.role !== 'authenticated' || !UUID_PATTERN.test(user.id ?? '')) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Būtina galiojanti vartotojo sesija.');
      }
      const { status = 200, body } = await handle({ request, token, user });
      return new Response(JSON.stringify(body), { status, headers });
    } catch (error) {
      const known = error instanceof ApiError;
      const retry = known && ['SNAPSHOT_STATUS_UNKNOWN', 'SNAPSHOT_RETRY'].includes(error.code);
      return new Response(JSON.stringify({ error: {
        code: known ? error.code : 'HISTORY_UNAVAILABLE',
        message: known ? error.message : 'Istorijos paslauga laikinai nepasiekiama.',
        ...(known && UUID_PATTERN.test(error.requestId ?? '') ? { request_id: error.requestId } : {}),
        ...(retry ? { retry_with_same_request_id: true } : {}),
      } }), { status: known ? error.status : 503, headers });
    }
  };
}

export function queryParams(request, names) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !names.includes(key) || params.getAll(key).length !== 1)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Netinkami arba pasikartojantys parametrai.');
  }
  return params;
}
