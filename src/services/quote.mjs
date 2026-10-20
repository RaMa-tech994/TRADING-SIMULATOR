import { SYMBOLS } from './history.mjs';
const pending = new WeakMap();
export function validatePreview(data, symbol) {
  const date = typeof data?.trading_date === 'string' ? new Date(data.trading_date + 'T00:00:00Z') : null;
  if (data?.symbol !== symbol || typeof data.price !== 'string' || !/^\d+(\.\d{1,6})?$/.test(data.price) ||
      !/[1-9]/.test(data.price) || data.price.length > 20 || data.is_realtime !== false ||
      !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== data.trading_date) {
    throw new Error('Gautas netinkamas kainos atsakymas.');
  }
  return data;
}
export function estimateOrder(price, quantity) {
  if (typeof price !== 'string' || !/^\d+(\.\d{1,6})?$/.test(price) || price.length > 20 ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) return null;
  const [whole, fraction = ''] = price.split('.');
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6,'0'));
  const cents = (micros + 5000n) / 10000n;
  if (cents <= 0n) return null;
  const format = amount => (amount / 100n).toString() + '.' + (amount % 100n).toString().padStart(2,'0');
  return { unit: format(cents), total: format(cents * BigInt(quantity)) };
}
export async function loadQuote(client, symbol, userId) {
  if (!SYMBOLS.includes(symbol)) throw new Error('Nepalaikoma akcija.');
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId) throw new Error('Prisijunkite, kad matytumėte kainą.');
  let requests = pending.get(client);
  if (!requests) { requests = new Map(); pending.set(client, requests); }
  const key = userId + ':' + symbol;
  if (!requests.has(key)) {
    const request = (async () => {
      const result = await client.functions.invoke('get-quote?symbol=' + encodeURIComponent(symbol), {
        method: 'GET', headers: { Authorization: 'Bearer ' + data.session.access_token },
      });
      if (result.error) throw new Error(result.error.context?.status === 429 ? 'Pasiektas kainų užklausų limitas. Bandykite vėliau.' : 'Kainos gauti nepavyko. Bandykite dar kartą vėliau.');
      return validatePreview(result.data, symbol);
    })().finally(() => requests.delete(key));
    requests.set(key, request);
  }
  return requests.get(key);
}
