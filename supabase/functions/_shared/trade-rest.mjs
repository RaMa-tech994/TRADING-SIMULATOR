import { ApiError } from './quotes.mjs';
import { sqlTradeError, unknownTradeOutcome } from './trade-errors.mjs';

// JSON skaičių tokenai išsaugomi kaip eilutės PRIEŠ JSON.parse.
// Kabutėse esantis tekstas nekeičiamas; pinigai nepraranda tikslumo ties 2^53 riba.
export function parseTradeJson(text) {
  const lossless = text.replace(
    /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => token.startsWith('"') ? token : JSON.stringify(token),
  );
  return JSON.parse(lossless);
}

// Finansinis RPC niekada nenaudoja administratoriaus Bearer rakto.
export function createTradeExecutor({ url, publicKey, fetcher = fetch }) {
  const base = url?.replace(/\/$/, '');
  return async function executeTrade(token, order) {
    if (!base || !publicKey) throw new ApiError(503, 'TRADE_NOT_CONFIGURED', 'Prekybos paslauga dar neparuošta.');
    if (!['buy', 'sell'].includes(order.side)) {
      throw new ApiError(400, 'INVALID_REQUEST', 'Netinkamas pavedimo veiksmas.');
    }
    let response;
    try {
      response = await fetcher(base + '/rest/v1/rpc/' + (order.side === 'buy' ? 'buy_stock' : 'sell_stock'), {
        method: 'POST',
        headers: { apikey: publicKey, Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_request_id: order.request_id, p_symbol: order.symbol, p_quantity: order.quantity,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw unknownTradeOutcome(); }
    if (!response.ok) {
      let error;
      try { error = await response.json(); } catch { throw unknownTradeOutcome(); }
      throw sqlTradeError(error, response.status);
    }
    try { return parseTradeJson(await response.text()); }
    catch { throw unknownTradeOutcome(); }
  };
}