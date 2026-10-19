import { ApiError } from './quotes.mjs';

// Naudojama standartinė fetch API; papildomos npm bibliotekos nereikia.
export function createBackend({ url, serviceKey, fetcher = fetch }) {
  const base = url?.replace(/\/$/, '');
  async function rpc(name, body) {
    const response = await fetcher(base + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new ApiError(503, 'CACHE_UNAVAILABLE', 'Kainų talpykla nepasiekiama.');
    return response.status === 204 ? null : response.json();
  }
  return {
    async authenticate(token) {
      if (!base || !serviceKey) throw new ApiError(503, 'NOT_CONFIGURED', 'Serveris nesukonfigūruotas.');
      const response = await fetcher(base + '/auth/v1/user', {
        headers: { apikey: serviceKey, Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401 || response.status === 403) return false;
      if (!response.ok) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Prisijungimo patikra nepasiekiama.');
      const user = await response.json();
      return typeof user.id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);
    },
    store: {
      reserve: symbol => rpc('av_reserve_quote', { p_symbol: symbol }),
      finish: (symbol, lease, quote, rateLimited = false) => rpc('av_finish_quote', {
        p_symbol: symbol, p_lease: lease, p_price: quote?.price ?? null,
        p_trading_date: quote?.trading_date ?? null, p_rate_limited: rateLimited,
      }),
    },
  };
}