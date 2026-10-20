import { SYMBOLS } from './history.mjs';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validOrder(order) {
  return order && uuid.test(order.request_id) && SYMBOLS.includes(order.symbol) &&
    ['BUY', 'SELL'].includes(order.side) && Number.isInteger(order.quantity) && order.quantity >= 1 && order.quantity <= 2147483647;
}
export function pendingKey(userId) { return 'tradesim:pending-trade:' + userId; }
export function readPending(storage, userId) {
  const text = storage.getItem(pendingKey(userId));
  if (!text) return null;
  const order = JSON.parse(text);
  if (!validOrder(order)) throw new Error('Netinkamas nebaigto pavedimo įrašas.');
  return order;
}
export function prepareOrder(storage, userId, fields, createId = () => crypto.randomUUID()) {
  const previous = readPending(storage, userId);
  if (previous) return previous;
  const order = { symbol: fields.symbol, side: fields.side, quantity: fields.quantity, request_id: createId() };
  if (!validOrder(order)) throw new Error('Pasirinkite akciją ir sveiką teigiamą kiekį.');
  storage.setItem(pendingKey(userId), JSON.stringify(order));
  return order;
}
const messages = {
  INSUFFICIENT_FUNDS: 'Nepakanka pinigų šiam pirkimui.',
  INSUFFICIENT_SHARES: 'Neturite pakankamai šios akcijos pardavimui.',
  QUOTE_STALE: 'Sandoriui trūksta aktualios dienos kainos. Bandykite vėliau.',
  QUOTE_UNVERIFIED: 'Kainos aktualumas nepatvirtintas. Sandoris neįvykdytas.',
  REQUEST_ID_CONFLICT: 'Pavedimo ID konfliktas. Nekurkite naujo pavedimo, kol nepatikrintas ankstesnis rezultatas.',
  UNAUTHORIZED: 'Sesija pasibaigė. Prisijunkite iš naujo.',
};
// Tik aiškiai atmesti pavedimai leidžia kurti kitą užklausos ID.
const rejected = new Set(['INSUFFICIENT_FUNDS','INSUFFICIENT_SHARES','QUOTE_STALE','QUOTE_UNVERIFIED','INVALID_REQUEST','INVALID_AMOUNT','POSITION_LIMIT','INVALID_AVERAGE_COST','BALANCE_LIMIT','PROFILE_NOT_FOUND','INVALID_QUOTE']);
function tradeError(message, definitive = false) { return Object.assign(new Error(message), { definitive }); }
export async function submitTrade(client, order, userId) {
  if (!validOrder(order)) throw tradeError('Netinkamas pavedimas.', true);
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId) throw tradeError('Sesija pasikeitė. Prisijunkite iš naujo.');
  let response;
  try {
    response = await client.functions.invoke('trade', { method: 'POST', headers: { Authorization: 'Bearer ' + data.session.access_token }, body: {
      symbol: order.symbol, side: order.side, quantity: order.quantity, request_id: order.request_id,
    } });
  } catch { throw tradeError('Sandorio baigtis nežinoma. Pakartokite tik tą patį pavedimą.'); }
  if (response.error) {
    let detail;
    try { detail = (await response.error.context?.clone().json())?.error; } catch { /* Serverio tekstai nerodomi. */ }
    const code = detail?.code;
    throw tradeError(messages[code] || (response.error.context?.status === 429 ? 'Pasiektas kainų užklausų limitas. Bandykite vėliau su tuo pačiu pavedimu.' : 'Sandorio rezultatas nepatvirtintas. Pakartokite tik tą patį pavedimą.'), rejected.has(code) && detail?.retry_with_same_request_id !== true);
  }
  const result = response.data;
  const tx = result?.transaction;
  const decimal = value => typeof value === 'string' && /^\d+(\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
  if (result?.success !== true || result.currency !== 'USD' || typeof result.replayed !== 'boolean' || result.request_id !== order.request_id ||
      !uuid.test(tx?.id ?? '') || tx.request_id !== order.request_id || tx.symbol !== order.symbol || tx.side !== order.side ||
      tx.quantity !== order.quantity || !decimal(tx.price) || !decimal(tx.total_amount) || !Number.isFinite(Date.parse(tx.executed_at))) {
    throw tradeError('Sandorio atsakymas nepatvirtintas. Pakartokite tik tą patį pavedimą.');
  }
  return result;
}
