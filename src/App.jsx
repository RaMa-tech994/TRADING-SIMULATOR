import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
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
            <NavLink to="/" style={({ isActive }) => ({ color: '#fff', textDecoration: 'none', backgroundColor: isActive ? '#10B981' : 'transparent', padding: '6px 12px', borderRadius: '4px' })}>Portfelis</NavLink>
            <NavLink to="/trading" style={({ isActive }) => ({ color: '#fff', textDecoration: 'none', backgroundColor: isActive ? '#10B981' : 'transparent', padding: '6px 12px', borderRadius: '4px' })}>Prekyba</NavLink>
            <NavLink to="/history" style={({ isActive }) => ({ color: '#fff', textDecoration: 'none', backgroundColor: isActive ? '#10B981' : 'transparent', padding: '6px 12px', borderRadius: '4px' })}>Istorija</NavLink>
            <NavLink to="/settings" style={({ isActive }) => ({ color: '#fff', textDecoration: 'none', backgroundColor: isActive ? '#10B981' : 'transparent', padding: '6px 12px', borderRadius: '4px' })}>Nustatymai</NavLink>
            <NavLink to="/login" style={({ isActive }) => ({ backgroundColor: '#10B981', padding: '6px 12px', borderRadius: '4px', color: '#fff', textDecoration: 'none', opacity: isActive ? 1 : 0.85 })}>Prisijungti</NavLink>
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
