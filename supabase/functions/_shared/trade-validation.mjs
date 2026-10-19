import { ApiError, validateSymbol } from './quotes.mjs';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = new Set(['symbol', 'side', 'quantity', 'request_id']);
const MAX_BYTES = 4096;

export function validateTrade(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== FIELDS.size ||
      Object.keys(body).some(key => !FIELDS.has(key)) ||
      [...FIELDS].some(key => !Object.hasOwn(body, key))) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Leidžiami tik symbol, side, quantity ir request_id.');
  }
  const symbol = validateSymbol(body.symbol);
  const side = typeof body.side === 'string' ? body.side.trim().toLowerCase() : '';
  if (!['buy', 'sell'].includes(side) ||
      !Number.isSafeInteger(body.quantity) || body.quantity <= 0 || body.quantity > 2147483647 ||
      typeof body.request_id !== 'string' || !UUID_PATTERN.test(body.request_id)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Patikrinkite BUY/SELL veiksmą, teigiamą sveiką kiekį ir UUID request_id.');
  }
  return { symbol, side, quantity: body.quantity, request_id: body.request_id.toLowerCase() };
}

export async function readTradeBody(request) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') ?? '')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Naudokite application/json.');
  }
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'Pavedimo užklausa per didelė.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON', 'Pateikite JSON pavedimą.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ApiError(413, 'BODY_TOO_LARGE', 'Pavedimo užklausa per didelė.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'Pateikite taisyklingą JSON pavedimą.');
  } finally {
    reader.releaseLock();
  }
}