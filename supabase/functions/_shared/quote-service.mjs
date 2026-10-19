import { ApiError, fetchQuote, validateQuote, validateSymbol } from './quotes.mjs';
import { describeQuote } from './freshness.mjs';

// Bendra get-quote ir trade serverio paslauga. Naudoja tik 002 rezervacijų RPC.
export function createQuoteService({ store, apiKey, fetcher = fetch, now = () => new Date() }) {
  return async function getQuote(value) {
    const symbol = validateSymbol(value);
    if (!apiKey?.trim()) throw new ApiError(503, 'NOT_CONFIGURED', 'Kainų API nesukonfigūruota.');
    let reservation;
    const cached = (fallback, warning) => {
      if (!reservation?.quote) return null;
      try {
        return describeQuote(validateQuote(reservation.quote, symbol, now()), {
          fetchedAt: reservation.quote.fetched_at, cached: true, fallback, now: now(), warning,
        });
      } catch { return null; }
    };
    try {
      reservation = await store.reserve(symbol);
      if (reservation.action === 'cache') {
        const quote = cached(false);
        if (!quote) throw new ApiError(502, 'INVALID_QUOTE', 'Talpyklos kaina nebetinkama.');
        return quote;
      }
      if (reservation.action !== 'fetch') {
        const quote = cached(true, 'Atnaujinimas negalimas; rodoma talpyklos dienos kaina.');
        if (quote) return quote;
        const busy = reservation.action === 'busy';
        throw new ApiError(busy ? 503 : 429, busy ? 'REFRESH_IN_PROGRESS' : 'QUOTE_LIMIT',
          busy ? 'Kaina atnaujinama. Bandykite vėliau.' : 'Kainų užklausų limitas. Bandykite vėliau.');
      }
      const quote = await fetchQuote(symbol, apiKey, fetcher, now());
      if (reservation.quote?.trading_date > quote.trading_date) {
        throw new ApiError(502, 'QUOTE_DATE_REGRESSION', 'Tiekėjas grąžino senesnę kainos datą.');
      }
      const fetchedAt = now().toISOString();
      await store.finish(symbol, reservation.lease, quote);
      return describeQuote(quote, { fetchedAt, cached: false, now: now() });
    } catch (error) {
      if (reservation?.action === 'fetch') {
        try {
          await store.finish(symbol, reservation.lease, null, error?.code === 'PROVIDER_LIMIT');
        } catch { /* Rezervacija turi ir automatinę galiojimo pabaigą. */ }
        const quote = cached(true, 'Atnaujinti nepavyko; rodoma talpyklos dienos kaina.');
        if (quote) return quote;
      }
      throw error;
    }
  };
}