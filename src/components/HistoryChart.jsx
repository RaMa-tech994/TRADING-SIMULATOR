import { useId } from 'react';
import { chartGeometry } from '../services/history.mjs';
export default function HistoryChart({ title, data, timeKey, valueKey, profit = false }) {
 const id = useId(); const points = data.points;
 if (!points.length) return <section className="history-card"><h2>{title}</h2><p>Istorijos dar nėra. Rodomi tik tikri išsaugoti stebėjimai.</p></section>;
 const { min, max, zeroY, coordinates } = chartGeometry(points, timeKey, valueKey, profit);
 return <section className="history-card"><h2 id={id}>{title}</h2><p className="history-value">{points.at(-1)[valueKey]} USD</p>
 {points.length === 1 && <p>Tik vienas stebėjimas — pokyčio dar negalima įvertinti.</p>}
 <svg viewBox="0 0 700 255" role="img" aria-labelledby={id}><desc>Vertės pagal laiką. Tikslūs duomenys lentelėje žemiau.</desc>
 {[min,(min+max)/2,max].map(value => { const y=210-(value-min)/(max-min)*180; return <g key={value}><line x1="80" x2="670" y1={y} y2={y} stroke="#444"/><text x="72" y={y+4} textAnchor="end">{value.toFixed(2)}</text></g>; })}
 {profit && <line x1="80" x2="670" y1={zeroY} y2={zeroY} stroke="#aaa" strokeDasharray="5 5"/>}
 <polyline points={coordinates.map(p=>[p.x,p.y].join(',')).join(' ')} fill="none" stroke={profit?'#a5b4fc':'#34d399'} strokeWidth="3"/>
 {coordinates.map((p,i)=><circle key={points[i][timeKey]} cx={p.x} cy={p.y} r="3" fill="#fff"><title>{points[i][timeKey]}: {points[i][valueKey]} USD</title></circle>)}
 <text x="80" y="242">{points[0][timeKey].slice(0,10)}</text><text x="670" y="242" textAnchor="end">{points.at(-1)[timeKey].slice(0,10)}</text></svg>
 <p>Laikas: UTC · Vertė: USD</p><details><summary>Rodyti tikslius duomenis ({points.length})</summary><div className="history-table"><table><thead><tr><th>Data (UTC)</th><th>USD</th></tr></thead><tbody>{points.map(p=><tr key={p[timeKey]}><td>{p[timeKey]}</td><td>{p[valueKey]}</td></tr>)}</tbody></table></div></details></section>;
}
