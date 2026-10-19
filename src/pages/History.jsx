import React from 'react';

export default function History() {
  const transactions = [
    { id: 1, date: '2026-10-19 14:30', type: 'BUY', symbol: 'AAPL', qty: 5, price: 185.50, total: 927.50 },
    { id: 2, date: '2026-10-18 10:15', type: 'BUY', symbol: 'TSLA', qty: 2, price: 220.00, total: 440.00 },
  ];

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#121212', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h1>📜 Sandorių Istorija & Statistika</h1>
      
      {/* Grafiko vieta (Placeholder) */}
      <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '1px dashed #444' }}>
        <h3>📈 Portfelio Vertės Grafikas</h3>
        <p style={{ color: '#888' }}>Grafikai bus prijungti antrame projekto etape.</p>
      </div>

      {/* Lentelė */}
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1e1e1e', borderRadius: '8px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '10px' }}>Data</th>
            <th>Tipas</th>
            <th>Simbolis</th>
            <th>Kiekis</th>
            <th>Kaina</th>
            <th>Bendra suma</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ padding: '10px' }}>{t.date}</td>
              <td style={{ color: t.type === 'BUY' ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>{t.type}</td>
              <td><b>{t.symbol}</b></td>
              <td>{t.qty} vnt.</td>
              <td>${t.price.toFixed(2)}</td>
              <td>${t.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}