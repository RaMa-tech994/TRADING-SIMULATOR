import React, { useState } from 'react';

export default function Settings() {
  const [simDate, setSimDate] = useState('2026-10-19');

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#121212', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h1>⚙️ Nustatymai (Settings)</h1>
      <div style={{ background: '#1e1e1e', padding: '20px', borderRadius: '8px', maxWidth: '400px' }}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Simuliacijos data (Istorinė data):</label>
          <input 
            type="date" 
            value={simDate} 
            onChange={(e) => setSimDate(e.target.value)}
            style={{ width: '93%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
          />
        </div>
        <p style={{ fontSize: '13px', color: '#aaa' }}>Pasirinkus istorinę datą, simuliacija naudos tos dienos akcijų kainas.</p>
      </div>
    </div>
  );
}