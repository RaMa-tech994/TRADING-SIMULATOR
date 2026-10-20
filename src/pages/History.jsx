import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { loadHistory, SYMBOLS } from '../services/history.mjs';
import HistoryChart from '../components/HistoryChart';
import './History.css';
function HistoryResource({ kind, symbol }) {
 const [state,setState]=useState({loading:true}); const [attempt,setAttempt]=useState(0);
 useEffect(()=>{ let active=true; loadHistory(supabase,kind,symbol).then(data=>{if(active)setState({data});}).catch(error=>{if(active)setState({error:error.message});}); return ()=>{active=false;}; },[kind,symbol,attempt]);
 const retry=()=>{setState({loading:true});setAttempt(v=>v+1);};
 if(state.loading)return <p role="status" className="history-card">Kraunama istorija…</p>;
 if(state.error)return <div className="history-card" role="alert"><p>{state.error}</p><button onClick={retry}>Bandyti dar kartą</button></div>;
 const data=state.data;
 return kind==='price'?<><p>Alpha Vantage · Dienos uždarymo kainos, ne realaus laiko. Nepakoreguotos dėl akcijų skaidymų ir dividendų.</p>
 {(data.stale||data.possibly_stale)&&<p className="history-warning" role="status">Duomenys gali būti pasenę. Paskutinė prekybos data: {data.latest_trading_date}.</p>}
 <HistoryChart title={symbol+' kainų istorija'} data={data} timeKey="date" valueKey="close"/></>:<>
 <p>Išsaugoti portfelio stebėjimai pagal dienos kainas. Atidarius puslapį nauji stebėjimai nekuriami.</p>
 <p>P/L — bendras realizuotas ir nerealizuotas rezultatas nuo pradinio {data.initial_balance} USD balanso, darant prielaidą, kad papildomų įnašų ar išėmimų nėra.</p>
 {data.has_more&&<p className="history-warning">Rodomi naujausi {data.points.length} stebėjimų. Yra senesnių duomenų.</p>}
 <div className="history-grid"><HistoryChart title="Portfelio vertės istorija" data={data} timeKey="captured_at" valueKey="portfolio_value"/><HistoryChart title="Pelno / nuostolio (P/L) istorija" data={data} timeKey="captured_at" valueKey="total_profit_loss" profit/></div></>;
}
export default function History(){
 const [symbol,setSymbol]=useState('AAPL'); const [auth,setAuth]=useState({loading:true});
 useEffect(()=>{let active=true;let changed=false;const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{changed=true;if(active)setAuth({user:session?.user.id});});supabase.auth.getSession().then(({data,error})=>{if(active&&!changed)setAuth({user:error?null:data.session?.user.id});}).catch(()=>{if(active&&!changed)setAuth({user:null});});return()=>{active=false;subscription.unsubscribe();};},[]);
 return <main className="history-page"><h1>Istorija ir statistika</h1>{auth.loading?<p role="status">Tikrinama sesija…</p>:!auth.user?<p><Link to="/login">Prisijunkite</Link>, kad matytumėte tikrą akcijų ir savo portfelio istoriją.</p>:<div key={auth.user}><label htmlFor="history-symbol">Akcija</label>{' '}<select id="history-symbol" value={symbol} onChange={e=>setSymbol(e.target.value)}>{SYMBOLS.map(item=><option key={item}>{item}</option>)}</select><HistoryResource key={symbol} kind="price" symbol={symbol}/><HistoryResource kind="portfolio"/></div>}</main>;
}
