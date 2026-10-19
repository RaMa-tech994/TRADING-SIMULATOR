import React from 'react';

export default function Portfolio() {
  const holdings = [
    { symbol: 'AAPL', name: 'Apple Inc.', qty: 10, avgPrice: 175.00, currentPrice: 185.50 },
    { symbol: 'TSLA', name: 'Tesla Inc.', qty: 5, avgPrice: 240.00, currentPrice: 220.00 },
  ];

  const totalValue = holdings.reduce((sum, h) => sum + h.qty * h.currentPrice, 0) + 5000;
  const cash = 5000;

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#121212', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h1>📊 Portfelis (Portfolio)</h1>
      
      {/* Kortelės */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '8px', flex: 1 }}>
          <h3>Bendra vertė</h3>
          <h2>${totalValue.toFixed(2)}</h2>
        </div>
        <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '8px', flex: 1 }}>
          <h3>Laisvi pinigai</h3>
          <h2>${cash.toFixed(2)}</h2>
        </div>
      </div>

      {/* Akcijų lentelė */}
      <h3>Turimos akcijos</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1e1e1e', borderRadius: '8px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '10px' }}>Simbolis</th>
            <th>Kiekis</th>
            <th>Pirkimo kaina</th>
            <th>Dabartinė kaina</th>
            <th>Pelnas / Nuostolis</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const profit = (h.currentPrice - h.avgPrice) * h.qty;
            const isPositive = profit >= 0;
            return (
              <tr key={h.symbol} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '10px' }}><b>{h.symbol}</b> ({h.name})</td>
                <td>{h.qty}</td>
                <td>${h.avgPrice.toFixed(2)}</td>
                <td>${h.currentPrice.toFixed(2)}</td>
                <td style={{ color: isPositive ? '#10B981' : '#EF4444', fontWeight: 'bold' }}>
                  {isPositive ? '+' : ''}${profit.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}