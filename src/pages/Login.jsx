import React, { useState } from 'react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    alert(`Prisijungta su: ${email}`);
  };

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#121212', minHeight: '100vh', fontFamily: 'sans-serif', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ background: '#1e1e1e', padding: '30px', borderRadius: '8px', width: '300px' }}>
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>🔐 Prisijungimas</h2>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>El. paštas:</label>
            <input 
              type="email" 
              required
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '92%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Slaptažodis:</label>
            <input 
              type="password" 
              required
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '92%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
            />
          </div>
          <button 
            type="submit" 
            style={{ width: '100%', padding: '10px', backgroundColor: '#10B981', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Prisijungti
          </button>
        </form>
      </div>
    </div>
  );
}