import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { SYMBOLS } from '../services/history.mjs';
import { loadPortfolio } from '../services/portfolio.mjs';
import { pendingKey, readPending, prepareOrder, submitTrade } from '../services/trading.mjs';
import QuotePreview from '../components/QuotePreview';
import './Trading.css';

function TradingForm({ userId }) {
  const [symbol, setSymbol] = useState('AAPL');
  const [side, setSide] = useState('BUY');
  const [quantity, setQuantity] = useState('1');
  const [pendingOrder, setPendingOrder] = useState(() => {
    try { return { order: readPending(localStorage, userId) }; }
    catch { return { blocked: true }; }
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [portfolio, setPortfolio] = useState({ loading: true });
  const [refresh, setRefresh] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    loadPortfolio(supabase).then(data => { if (active) setPortfolio({ data }); })
      .catch(() => { if (active) setPortfolio({ error: 'Balanso gauti nepavyko. Portfelyje galite patikrinti naujausią būseną.' }); });
    return () => { active = false; };
  }, [refresh, userId]);

  async function execute(event) {
    event.preventDefault();
    if (submitting.current || pendingOrder.blocked) return;
    submitting.current = true;
    setBusy(true); setMessage(''); setFailed(false);
    let order;
    try {
      try { order = prepareOrder(localStorage, userId, { symbol, side, quantity: Number(quantity) }); }
      catch { throw new Error('Pavedimo saugiai išsaugoti nepavyko. Patikrinkite kiekį ir naršyklės saugyklos leidimus.'); }
      setPendingOrder({ order });
      const result = await submitTrade(supabase, order, userId);
      try { localStorage.removeItem(pendingKey(userId)); setPendingOrder({ order: null }); }
      catch { setPendingOrder({ order }); }
      setMessage('Sandoris išsaugotas duomenų bazėje: ' + result.transaction.side + ' ' + result.transaction.quantity + ' ' + result.transaction.symbol + ', suma ' + result.transaction.total_amount + ' USD.');
      setPortfolio({ loading: true }); setRefresh(value => value + 1);
    } catch (error) {
      if (error.definitive && order) {
        try { localStorage.removeItem(pendingKey(userId)); setPendingOrder({ order: null }); } catch { /* Išsaugomas tas pats pavedimas. */ }
      }
      setFailed(true); setMessage(error.message);
    } finally { submitting.current = false; setBusy(false); }
  }
  const order = pendingOrder.order;
  return <>
    <section className="trading-card" aria-live="polite"><h2>Laisvi pinigai</h2>
      {portfolio.loading ? <p>Kraunamas balansas…</p> : portfolio.error ? <p>{portfolio.error}</p> : <><p className="trading-balance">{portfolio.data.cash_balance} USD</p><p>Turimos akcijos: {portfolio.data.positions.length ? portfolio.data.positions.map(p => p.symbol + ': ' + p.quantity).join(', ') : 'Akcijų dar nėra.'}</p></>}
      <Link to="/">Atidaryti portfelį</Link>
    </section>
    <section className="trading-card"><h2>Virtualus sandoris</h2>
      <p>Sandoris vykdomas pagal serveryje patikrintą dienos kainą. Galutinę kainą ir sumą apskaičiuoja serveris. Tai nėra realaus laiko kotiruotė.</p>
      {pendingOrder.blocked && <p role="alert">Nepavyko perskaityti nebaigto pavedimo. Naujas pavedimas blokuojamas, kol nepatikrintas ankstesnis rezultatas ir naršyklės saugykla.</p>}
      {order && <p role="status">Nebaigtas pavedimas: {order.side} {order.quantity} {order.symbol}. Pakartojimas naudos tą patį ID ir nesukurs to paties sandorio dublikato.</p>}
      <form onSubmit={execute}>
        <fieldset disabled={busy || Boolean(order) || pendingOrder.blocked}>
          <label htmlFor="trade-side">Veiksmas</label><select id="trade-side" value={order?.side || side} onChange={event => setSide(event.target.value)}><option value="BUY">Pirkti</option><option value="SELL">Parduoti</option></select>
          <label htmlFor="trade-symbol">Akcija</label><select id="trade-symbol" value={order?.symbol || symbol} onChange={event => setSymbol(event.target.value)}>{SYMBOLS.map(value => <option key={value}>{value}</option>)}</select>
          <label htmlFor="trade-quantity">Kiekis</label><input id="trade-quantity" type="number" min="1" max="2147483647" step="1" required value={order?.quantity ?? quantity} onChange={event => setQuantity(event.target.value)}/>
        </fieldset>
        <QuotePreview key={order?.symbol || symbol} symbol={order?.symbol || symbol} quantity={order?.quantity ?? quantity} userId={userId}/>
        <button type="submit" disabled={busy || pendingOrder.blocked}>{busy ? 'Vykdomas sandoris…' : order ? 'Pakartoti tą patį pavedimą' : side === 'BUY' ? 'Pirkti ir išsaugoti sandorį' : 'Parduoti ir išsaugoti sandorį'}</button>
      </form>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </section>
  </>;
}
export default function Trading() {
  const [auth, setAuth] = useState({ loading: true });
  useEffect(() => {
    if (!supabase) return;
    let active = true; let changed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { changed = true; if (active) setAuth({ user: session?.user.id }); });
    supabase.auth.getSession().then(({ data, error }) => { if (active && !changed) setAuth({ user: error ? null : data.session?.user.id }); })
      .catch(() => { if (active && !changed) setAuth({ user: null }); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return <main className="trading-page"><h1>Akcijų prekyba</h1>{!supabase ? <p role="alert">Supabase nesukonfigūruotas.</p> : auth.loading ? <p role="status">Tikrinama sesija…</p> : !auth.user ? <p><Link to="/login">Prisijunkite</Link>, kad galėtumėte pirkti ir parduoti akcijas.</p> : <TradingForm key={auth.user} userId={auth.user}/>}</main>;
}
