import { useEffect, useState } from 'react';
import { supabase } from '../pages/supabaseClient';
import { estimateOrder, loadQuote } from '../services/quote.mjs';

export default function QuotePreview({ symbol, quantity, userId }) {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadQuote(supabase, symbol, userId).then(data => { if (active) setState({ data }); })
      .catch(error => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, [symbol, userId, attempt]);
  if (state.loading) return <div className="quote-preview" role="status">Kraunama {symbol} dienos kaina…</div>;
  if (state.error) return <div className="quote-preview" role="alert"><p>{state.error}</p><button type="button" onClick={() => { setState({ loading: true }); setAttempt(value => value + 1); }}>Pakartoti kainos užklausą</button></div>;
  const quote = state.data;
  const estimate = estimateOrder(quote.price, Number(quantity));
  const stale = quote.stale || quote.possibly_stale || !quote.cache_fresh || quote.price_freshness !== 'recent_daily';
  return <section className="quote-preview" aria-label="Akcijos kainos peržiūra" aria-live="polite">
    <h3>{symbol} dienos kaina: {quote.price} USD</h3>
    <p>Prekybos data: {quote.trading_date} · Alpha Vantage · Ne realaus laiko kaina</p>
    {stale && <p className="quote-warning">Kaina pasenusi arba jos aktualumas nepatvirtintas. Ji gali netikti sandoriui.</p>}
    {estimate ? <><p>Preliminari vieneto vykdymo kaina: {estimate.unit} USD</p><p><strong>Preliminari suma: {estimate.total} USD</strong></p></> : <p>Preliminariai sumai įveskite tinkamą sveiką kiekį.</p>}
    <p>{stale ? 'Suma tik orientacinė pagal rodomą kainą.' : 'Preliminari suma pagal rodomą dienos kainą.'} Galutinę kainą ir sumą patvirtina serveris vykdydamas sandorį.</p>
  </section>;
}
