import React, { useState } from 'react';

export default function Trading() {
  const [symbol, setSymbol] = useState('AAPL');
  const [quantity, setQuantity] = useState(1);
  const [action, setAction] = useState('BUY');

  // Pradinis virtualus pinigų balansas
  const [cashBalance, setCashBalance] = useState(10000.00);

  // Demonstracinė akcijos kaina
  const stockPrices = { AAPL: 185.50, TSLA: 220.00, NVDA: 120.00, AMZN: 180.00 };
  const currentPrice = stockPrices[symbol] || 100.00;
  const totalPrice = currentPrice * quantity;

  const handleSubmit = (e) => {
    e.preventDefault();

    if (action === 'BUY') {
      // Patikriname, ar pakanka lėšų pirkimui
      if (totalPrice > cashBalance) {
        alert(`Nepakanka lėšų! Jūsų balansas yra $${cashBalance.toFixed(2)}, o sandorio suma $${totalPrice.toFixed(2)}.`);
        return;
      }
      // Nuskaičiuojame pinigus nuo balanso
      setCashBalance(prev => prev - totalPrice);
      alert(`Sėkmingai nupirkta: ${quantity} vnt. ${symbol} už $${totalPrice.toFixed(2)}`);
    } else {
      // Pardavimo atveju pinigai grįžta į balansą
      setCashBalance(prev => prev + totalPrice);
      alert(`Sėkmingai parduota: ${quantity} vnt. ${symbol} už $${totalPrice.toFixed(2)}`);
    }
  };

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#121212', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h1>📈 Akcijų Prekyba (Trading)</h1>

      {/* Laisvų pinigų rodymas */}
      <div style={{ background: '#1e1e1e', padding: '15px', borderRadius: '8px', marginBottom: '20px', display: 'inline-block' }}>
        <p style={{ margin: 0, fontSize: '16px' }}>Laisvi pinigai sąskaitoje: <b style={{ color: '#10B981' }}>${cashBalance.toFixed(2)}</b></p>
      </div>

      <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
        {/* Pirkimo / Pardavimo forma */}
        <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '8px', width: '320px' }}>
          <h3>Vykdyti Sandorį</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Veiksmas:</label>
              <select 
                value={action} 
                onChange={(e) => setAction(e.target.value)}
                style={{ width: '100%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
              >
                <option value="BUY">PIRKTI (BUY)</option>
                <option value="SELL">PARDUOTI (SELL)</option>
              </select>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Akcijos Simbolis:</label>
              <select 
                value={symbol} 
                onChange={(e) => setSymbol(e.target.value)}
                style={{ width: '100%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
              >
                <option value="AAPL">AAPL (Apple) - $185.50</option>
                <option value="TSLA">TSLA (Tesla) - $220.00</option>
                <option value="NVDA">NVDA (Nvidia) - $120.00</option>
                <option value="AMZN">AMZN (Amazon) - $180.00</option>
              </select>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Kiekis:</label>
              <input 
                type="number" 
                min="1" 
                value={quantity} 
                onChange={(e) => setQuantity(Number(e.target.value))}
                style={{ width: '93%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
              />
            </div>

            <div style={{ marginBottom: '20px', padding: '10px', background: '#2a2a2a', borderRadius: '4px' }}>
              <p style={{ margin: 0 }}>Bendra suma: <b>${totalPrice.toFixed(2)}</b></p>
            </div>

            <button 
              type="submit" 
              style={{ 
                width: '100%', 
                padding: '10px', 
                backgroundColor: action === 'BUY' ? '#10B981' : '#EF4444', 
                color: '#fff', 
                border: 'none', 
                borderRadius: '4px', 
                fontWeight: 'bold', 
                cursor: 'pointer' 
              }}
            >
              {action === 'BUY' ? 'Patvirtinti Pirkimą' : 'Patvirtinti Pardavimą'}
            </button>
          </form>
        </div>

        {/* Informacija apie rinką */}
        <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '8px', flex: 1, minWidth: '250px' }}>
          <h3>Populiarios Akcijos</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <li style={{ padding: '10px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
              <span><b>AAPL</b> - Apple Inc.</span>
              <span style={{ color: '#10B981' }}>$185.50 (+1.2%)</span>
            </li>
            <li style={{ padding: '10px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
              <span><b>TSLA</b> - Tesla Inc.</span>
              <span style={{ color: '#EF4444' }}>$220.00 (-0.8%)</span>
            </li>
            <li style={{ padding: '10px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
              <span><b>NVDA</b> - Nvidia Corp.</span>
              <span style={{ color: '#10B981' }}>$120.00 (+3.5%)</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}