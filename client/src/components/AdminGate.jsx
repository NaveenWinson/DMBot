import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getAuth } from '../lib/catalyst';
import styles from './AdminGate.module.css';

// Loads the settings once to check sign-in, then renders children(settings, reload).
export default function AdminGate({ children }) {
  const [state, setState] = useState('checking'); // checking | signin | forbidden | error | ready
  const [settings, setSettings] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
      setState('ready');
    } catch (e) {
      if (e.status === 401) setState('signin');
      else if (e.status === 403) setState('forbidden');
      else { setErrorMsg(e.message || 'Could not reach the server'); setState('error'); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (state !== 'signin') return;
    const auth = getAuth();
    if (auth) auth.signIn('admin-login');
  }, [state]);

  if (state === 'checking') return <p className="muted">Loading…</p>;
  if (state === 'signin') {
    return (
      <div className={`card ${styles.signin}`}>
        <h1>Sign in</h1>
        <p className="muted">Sign in with the Catalyst account set as ADMIN_EMAIL.</p>
        <div id="admin-login" />
      </div>
    );
  }
  if (state === 'forbidden') return <p className="banner bannerBad">This account is not allowed to manage DMBot.</p>;
  if (state === 'error') {
    return (
      <div className="card">
        <p className="banner bannerBad">{errorMsg}</p>
        <button className="btnPrimary" onClick={() => { setState('checking'); load(); }}>Retry</button>
      </div>
    );
  }
  return children(settings, load);
}
