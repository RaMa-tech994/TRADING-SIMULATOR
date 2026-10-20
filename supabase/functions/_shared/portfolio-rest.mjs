import { ApiError } from './quotes.mjs';

export function createPortfolioReader({ url, publicKey, fetcher = fetch }) {
  return async function readPortfolio(token, userId) {
    if (!url || !publicKey) throw new ApiError(503, 'NOT_CONFIGURED', 'Portfelio paslauga nesukonfigūruota.');
    let response;
    try {
      response = await fetcher(url.replace(/\/$/, '') + '/rest/v1/rpc/get_portfolio_snapshot', {
        method: 'POST', headers: { apikey: publicKey, Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
      });
    } catch { throw new ApiError(503, 'PORTFOLIO_UNAVAILABLE', 'Portfelio nuskaityti nepavyko.'); }
    if (response.status === 401) throw new ApiError(401, 'UNAUTHORIZED', 'Prisijunkite iš naujo.');
    if (!response.ok) throw new ApiError(503, 'PORTFOLIO_UNAVAILABLE', 'Portfelio nuskaityti nepavyko.');
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError(503, 'INVALID_PORTFOLIO', 'Portfelio duomenys netinkami.'); }
    if (data === null) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Vartotojo profilis nerastas.');
    if (data?.user_id !== userId || typeof data.snapshot_at !== 'string' || !Number.isFinite(Date.parse(data.snapshot_at))) {
      throw new ApiError(503, 'INVALID_PORTFOLIO', 'Portfelio duomenys netinkami.');
    }
    return data;
  };
}
