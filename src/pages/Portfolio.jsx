import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { loadPortfolio } from '../services/portfolio.mjs';
import './Portfolio.css';

const usd = value => value == null ? 'Neįvertinta' : value + ' USD';
function PortfolioData() {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadPortfolio(supabase).then(data => { if (active) setState({ data }); })
      .catch(error => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, [attempt]);
  if (state.loading) return <p role="status">Kraunamas jūsų portfelis…</p>;
  if (state.error) return <div role="alert"><p>{state.error}</p><button onClick={() => { setState({ loading: true }); setAttempt(value => value + 1); }}>Bandyti dar kartą</button></div>;
  const data = state.data;
  return <>
    <div className="portfolio-cards"><section><h2>Bendra vertė</h2><p>{usd(data.valuation_complete ? data.total_portfolio_value : null)}</p></section><section><h2>Laisvi pinigai</h2><p>{usd(data.cash_balance)}</p></section></div>
    {!data.valuation_complete && <p role="status">Trūksta aktualių kainų. Visa portfelio vertė kol kas neįvertinta; laisvų pinigų balansas yra tikras.</p>}
    <h2>Turimos akcijos</h2>
    {!data.positions.length ? <p>Akcijų dar neturite. <Link to="/trading">Pereiti į prekybą</Link></p> : <><p>Dienos kainos, ne realaus laiko kotiruotės.</p><div className="portfolio-table"><table><thead><tr><th>Simbolis</th><th>Kiekis</th><th>Vidutinė įsigijimo kaina</th><th>Dienos kaina</th><th>Nerealizuotas P/L</th></tr></thead><tbody>{data.positions.map(position => <tr key={position.symbol}><td>{position.symbol}</td><td>{position.quantity}</td><td>{usd(position.average_cost)}</td><td>{usd(position.current_price)}{position.trading_date && <small>{position.trading_date}</small>}{position.valuation_status !== 'valued' && <small>Aktuali kaina nepatvirtinta</small>}</td><td>{usd(position.unrealized_profit_loss)}</td></tr>)}</tbody></table></div></>}
  </>;
}
export default function Portfolio() {
  const [auth, setAuth] = useState({ loading: true });
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let changed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { changed = true; if (active) setAuth({ user: session?.user.id }); });
    supabase.auth.getSession().then(({ data, error }) => { if (active && !changed) setAuth({ user: error ? null : data.session?.user.id }); })
      .catch(() => { if (active && !changed) setAuth({ user: null }); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return <main className="portfolio-page"><h1>Portfelis</h1>{!supabase ? <p role="alert">Supabase nesukonfigūruotas.</p> : auth.loading ? <p role="status">Tikrinama sesija…</p> : !auth.user ? <p><Link to="/login">Prisijunkite</Link>, kad matytumėte savo balansą.</p> : <PortfolioData key={auth.user}/>}</main>;
}
