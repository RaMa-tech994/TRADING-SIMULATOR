import React, { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (isLogin) {
        // Prisijungimas su Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setMessage(`Prisijungimo klaida: ${error.message}`);
        } else {
          setMessage('Sėkmingai prisijungėte!');
          console.log('Vartotojo duomenys:', data);
        }
      } else {
        // Registracija su Supabase
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          setMessage(`Registracijos klaida: ${error.message}`);
        } else if (data.user && data.user.identities && data.user.identities.length === 0) {
          setMessage('Šis el. pašto adresas jau užregistruotas!');
        } else {
          setMessage(data.session ? 'Registracija sėkminga, prisijungėte' : 'Registracija sėkminga! Patikrinkite savo el. paštą patvirtinimui.');
          console.log('Naujas vartotojas:', data);
        }
      }
    } catch (err) {
      setMessage(`Įvyko nenumatyta klaida: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[80vh]">
      <div className="bg-slate-800 p-8 rounded-xl shadow-lg w-full max-w-md border border-slate-700">
        <h2 className="text-2xl font-bold text-white text-center mb-6">
          {isLogin ? 'Prisijungti prie TradeSim' : 'Sukurti naują paskyrą'}
        </h2>

        {message && (
          <div
            className={`p-3 rounded-lg text-sm mb-4 text-center ${
              message.includes('klaida') || message.includes('Klaida') || message.includes('jau užregistruotas')
                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            }`}
          >
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1">
              El. paštas
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vardenis@pavyzdys.lt"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1">
              Slaptažodis
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-2 px-4 rounded-lg transition duration-200 disabled:opacity-50"
          >
            {loading ? 'Kraunasi...' : isLogin ? 'Prisijungti' : 'Registruotis'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-slate-400 text-sm">
            {isLogin ? 'Dar neturite paskyros?' : 'Jau turite paskyrą?'}{' '}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setMessage('');
              }}
              className="text-emerald-400 font-semibold hover:underline ml-1"
            >
              {isLogin ? 'Registruotis' : 'Prisijungti'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}