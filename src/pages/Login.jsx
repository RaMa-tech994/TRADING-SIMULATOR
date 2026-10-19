import React, { useState } from 'react';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!isLogin && password !== confirmPassword) {
      alert('Slaptažodžiai nesutampa!');
      return;
    }

    if (isLogin) {
      alert(`Prisijungiama su: ${email}`);
    } else {
      alert(`Registruojamas naujas vartotojas: ${email}`);
    }
  };

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#121212', minHeight: '100vh', fontFamily: 'sans-serif', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ background: '#1e1e1e', padding: '30px', borderRadius: '8px', width: '320px', border: '1px solid #333' }}>
        
        <div style={{ display: 'flex', marginBottom: '20px', borderBottom: '1px solid #333' }}>
          <button 
            type="button"
            onClick={() => setIsLogin(true)}
            style={{
              flex: 1, padding: '10px', backgroundColor: 'transparent',
              color: isLogin ? '#10B981' : '#888', border: 'none',
              borderBottom: isLogin ? '2px solid #10B981' : 'none',
              fontWeight: 'bold', cursor: 'pointer'
            }}
          >
            Prisijungti
          </button>
          <button 
            type="button"
            onClick={() => setIsLogin(false)}
            style={{
              flex: 1, padding: '10px', backgroundColor: 'transparent',
              color: !isLogin ? '#10B981' : '#888', border: 'none',
              borderBottom: !isLogin ? '2px solid #10B981' : 'none',
              fontWeight: 'bold', cursor: 'pointer'
            }}
          >
            Registruotis
          </button>
        </div>

        <h3 style={{ marginTop: 0, textAlign: 'center' }}>
          {isLogin ? '🔐 Prisijungimas' : '📝 Nauja Registracija'}
        </h3>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>El. paštas:</label>
            <input 
              type="text" 
              required
              placeholder="pavyzdys@email.com"
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '92%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>Slaptažodis:</label>
            <input 
              type="password" 
              required
              placeholder="••••••••"
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '92%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
            />
          </div>

          {!isLogin && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>Pakartokite slaptažodį:</label>
              <input 
                type="password" 
                required
                placeholder="••••••••"
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ width: '92%', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
              />
            </div>
          )}

          <button 
            type="submit" 
            style={{ 
              width: '100%', padding: '10px', backgroundColor: '#10B981', 
              color: '#fff', border: 'none', borderRadius: '4px', 
              fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' 
            }}
          >
            {isLogin ? 'Prisijungti' : 'Registruotis'}
          </button>
        </form>

      </div>
    </div>
  );
}