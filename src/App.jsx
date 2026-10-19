import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Portfolio from './pages/Portfolio';
import Trading from './pages/Trading';
import History from './pages/History';
import Settings from './pages/Settings';
import Login from './pages/Login';

export default function App() {
  return (
    <Router>
      <div style={{ backgroundColor: '#121212', minHeight: '100vh', color: '#fff' }}>
        {/* Viršutinė navigacijos juosta */}
        <nav style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 30px', backgroundColor: '#1e1e1e', borderBottom: '1px solid #333' }}>
          <h2 style={{ margin: 0, color: '#10B981' }}>📈 TradeSim</h2>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <Link to="/" style={{ color: '#fff', textDecoration: 'none' }}>Portfelis</Link>
            <Link to="/trading" style={{ color: '#fff', textDecoration: 'none' }}>Prekyba</Link>
            <Link to="/history" style={{ color: '#fff', textDecoration: 'none' }}>Istorija</Link>
            <Link to="/settings" style={{ color: '#fff', textDecoration: 'none' }}>Nustatymai</Link>
            <Link to="/login" style={{ backgroundColor: '#10B981', padding: '6px 12px', borderRadius: '4px', color: '#fff', textDecoration: 'none' }}>Prisijungti</Link>
          </div>
        </nav>

        {/* Puslapių maršrutai */}
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/trading" element={<Trading />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </div>
    </Router>
  );
}