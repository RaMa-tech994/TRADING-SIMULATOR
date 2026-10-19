import { ApiError } from './quotes.mjs';

const BUSINESS = {
  PROFILE_NOT_FOUND: [404, 'Vartotojo profilis nerastas.'],
  REQUEST_ID_CONFLICT: [409, 'Šis request_id jau panaudotas kitokiam pavedimui.'],
  INSUFFICIENT_FUNDS: [409, 'Nepakanka virtualių pinigų.'],
  INSUFFICIENT_SHARES: [409, 'Nepakanka turimų akcijų.'],
  QUOTE_UNAVAILABLE: [503, 'Akcijos kaina dar negauta.'],
  QUOTE_CACHE_EXPIRED: [409, 'Kainos talpyklos galiojimas pasibaigęs.'],
  QUOTE_STALE: [409, 'Kainos prekybos data per sena sandoriui.'],
  QUOTE_UNVERIFIED: [503, 'Kainos aktualumas nepatvirtintas.'],
  INVALID_QUOTE: [502, 'Nepavyko patvirtinti akcijos kainos.'],
};
const AMOUNTS = new Set(['INVALID_AMOUNT', 'POSITION_LIMIT', 'INVALID_AVERAGE_COST', 'BALANCE_LIMIT']);

export function sqlTradeError(body, status) {
  if (status === 401 || ['28000', 'PGRST301', 'PGRST302', 'PGRST303'].includes(body?.code)) {
    return new ApiError(401, 'UNAUTHORIZED', 'Prisijungimo sesija negalioja.');
  }
  if (body?.code === 'P0001' && Object.hasOwn(BUSINESS, body.message)) {
    const [httpStatus, message] = BUSINESS[body.message];
    return new ApiError(httpStatus, body.message, message);
  }
  if (body?.code === '22003' && AMOUNTS.has(body.message)) {
    return new ApiError(422, body.message, 'Sandorio suma arba akcijų kiekis nepatenka į leistinas ribas.');
  }
  if (body?.code === '22023' && body.message === 'INVALID_REQUEST') {
    return new ApiError(400, 'INVALID_REQUEST', 'Pavedimo parametrai netinkami.');
  }
  if (['40001', '40P01', '55P03'].includes(body?.code)) {
    return new ApiError(503, 'TRADE_RETRY', 'Pavedimą pakartokite su tuo pačiu request_id.');
  }
  if (body?.code === '42501' || body?.code === 'PGRST202') {
    return new ApiError(503, 'TRADE_NOT_CONFIGURED', 'Prekybos paslauga dar neparuošta.');
  }
  // Nežinoma serverio klaida gali būti gauta ir po neaiškios ryšio baigties.
  return unknownTradeOutcome();
}

export function unknownTradeOutcome() {
  return new ApiError(503, 'TRADE_STATUS_UNKNOWN',
    'Pavedimo baigtis nepatvirtinta. Pakartokite tik su tuo pačiu request_id.');
}