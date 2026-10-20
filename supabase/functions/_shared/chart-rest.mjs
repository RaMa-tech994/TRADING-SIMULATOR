import { ApiError } from './quotes.mjs';
const unknown = () => new ApiError(503, 'SNAPSHOT_STATUS_UNKNOWN', 'Įrašymo baigtis nepatvirtinta. Kartokite tik su tuo pačiu request_id.');
const BUSINESS = {
  PROFILE_NOT_FOUND: [404, 'Vartotojo profilis nerastas.'],
  SNAPSHOT_TOO_SOON: [429, 'Naują istorijos tašką galima įrašyti ne dažniau kaip kartą per minutę.'],
  INCOMPLETE_VALUATION: [409, 'Trūksta tinkamų kainų. Nepilnas portfelio taškas neįrašytas.'],
  QUOTE_UNVERIFIED: [503, 'Kainų aktualumas nepatvirtintas pagal biržos kalendorių.'],
};

export function createChartBackend({ url, publicKey, serviceKey = undefined, fetcher = fetch }) {
  const base = url?.replace(/\/$/, '');
  async function rpc(name, body, token, admin = false, capture = false) {
    const key = admin ? serviceKey : publicKey;
    if (!base || !key || !token) throw new ApiError(503, 'HISTORY_NOT_CONFIGURED', 'Istorijos paslauga nesukonfigūruota.');
    let response;
    try {
      response = await fetcher(base + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch { throw capture ? unknown() : new ApiError(503, 'HISTORY_UNAVAILABLE', 'Istorijos duomenys nepasiekiami.'); }
    if (!response.ok) {
      let error;
      try { error = await response.json(); } catch { throw capture ? unknown() : new ApiError(503, 'HISTORY_UNAVAILABLE', 'Istorijos duomenys nepasiekiami.'); }
      if (response.status === 401 || error?.code === '28000') throw new ApiError(401, 'UNAUTHORIZED', 'Prisijunkite iš naujo.');
      if (error?.code === 'P0001' && Object.hasOwn(BUSINESS, error.message)) {
        const [status, message] = BUSINESS[error.message]; throw new ApiError(status, error.message, message);
      }
      if (error?.code === '22023') throw new ApiError(400, 'INVALID_REQUEST', 'Netinkami istorijos parametrai.');
      if (error?.code === '22003') throw new ApiError(422, 'VALUATION_LIMIT', 'Portfelio vertė viršija leistinas ribas.');
      if (['42501', 'PGRST202'].includes(error?.code)) throw new ApiError(503, 'HISTORY_NOT_CONFIGURED', 'Istorijos funkcijos dar neparuoštos.');
      if (capture && ['40001', '40P01', '55P03'].includes(error?.code)) {
        throw new ApiError(503, 'SNAPSHOT_RETRY', 'Pakartokite įrašymą su tuo pačiu request_id.');
      }
      throw capture ? unknown() : new ApiError(503, 'HISTORY_UNAVAILABLE', 'Istorijos duomenys nepasiekiami.');
    }
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch { throw capture ? unknown() : new ApiError(503, 'INVALID_HISTORY', 'Istorijos atsakymas netinkamas.'); }
  }
  return {
    priceStore: {
      reserve: symbol => rpc('av_reserve_price_history', { p_symbol: symbol }, serviceKey, true),
      finish: (symbol, lease, points, rateLimited = false) => rpc('av_finish_price_history', {
        p_symbol: symbol, p_lease: lease, p_points: points, p_rate_limited: rateLimited,
      }, serviceKey, true),
    },
    list: (token, range) => rpc('get_portfolio_history', range, token),
    capture: (token, requestId) => rpc('capture_portfolio_snapshot', { p_request_id: requestId }, token, false, true),
  };
}
