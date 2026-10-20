import { ApiError, validateSymbol } from './quotes.mjs';
import { historyHttp, queryParams } from './history-http.mjs';
export function createPriceHistoryHandler({ getUser, getHistory, origins }) {
  return historyHttp({ getUser, origins, methods: ['GET'], handle: async ({ request }) => {
    const params = queryParams(request, ['symbol']);
    if (!params.has('symbol')) throw new ApiError(400, 'INVALID_REQUEST', 'Reikia vieno symbol parametro.');
    return { body: await getHistory(validateSymbol(params.get('symbol'))) };
  } });
}
