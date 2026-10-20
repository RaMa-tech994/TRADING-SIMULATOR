import { useEffect, useRef, useState } from 'react';
import { supabase } from '../pages/supabaseClient';
import { captureHistory } from '../services/history.mjs';

export default function CaptureSnapshot({ userId, onSaved }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const busy = useRef(false);
  const storageKey = 'tradesim:pending-snapshot:' + userId;
  const [retry, setRetry] = useState(() => {
    try { return Boolean(sessionStorage.getItem(storageKey)); } catch { return false; }
  });

  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function save() {
    if (busy.current || cooldown) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    setMessage('');
    try {
      let requestId;
      try {
        requestId = sessionStorage.getItem(storageKey) || crypto.randomUUID();
        sessionStorage.setItem(storageKey, requestId);
      } catch {
        throw new Error('Naršyklė negali išsaugoti bandymo. Leiskite šios svetainės sesijos saugyklą.');
      }
      setRetry(true);
      await captureHistory(supabase, requestId, userId);
      // Saugyklos klaidos atveju paliktas ID leidžia saugiai pakartoti tą patį įrašą.
      try { sessionStorage.removeItem(storageKey); setRetry(false); } catch { /* ID išlieka saugiam pakartojimui. */ }
      setMessage('Dabartinis portfelio stebėjimas išsaugotas. Grafikai atnaujinami.');
      setCooldown(60);
      onSaved();
    } catch (error) {
      setFailed(true);
      setMessage(error.message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <section className="history-card" aria-label="Portfelio stebėjimo išsaugojimas">
    <button type="button" onClick={save} disabled={pending || cooldown > 0}>
      {pending ? 'Išsaugoma…' : cooldown > 0 ? 'Palaukite ' + cooldown + ' s' : retry ? 'Pakartoti tą patį išsaugojimą' : 'Išsaugoti dabartinę portfelio vertę'}
    </button>
    <p>Įrašoma dabartinė portfelio vertė ir bendras P/L. Naujas stebėjimas galimas kartą per minutę.</p>
    {retry && !pending && <p>Yra nebaigtas bandymas. Pakartojimas nesukurs to paties stebėjimo dublikato.</p>}
    {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
  </section>;
}
