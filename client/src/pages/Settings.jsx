import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { daysLeft, formatDate } from '../lib/format';
import { connectBanner } from '../lib/connectBanner';
import styles from './Settings.module.css';

export default function Settings({ settings, onSaved }) {
  const location = useLocation();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(() => connectBanner(location.search)); // { type: 'good' | 'bad', text }
  const webhookUrl = `${window.location.origin}/server/webhook/`;
  const left = daysLeft(settings.tokenExpiresAt);

  async function connect() {
    setBusy(true);
    setNote(null);
    try {
      const { url } = await api.oauthStart();
      window.location.assign(url); // Instagram's login page, which comes back to Settings
    } catch (err) {
      setNote({ type: 'bad', text: err.message });
      setBusy(false);
    }
  }

  async function saveToken(e) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const s = await api.saveToken(token.trim());
      setToken('');
      setNote({ type: 'good', text: `Connected as @${s.username}. Comment notifications are switched on.` });
      onSaved();
    } catch (err) {
      setNote({ type: 'bad', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Settings</h1>
      {note && <p className={`banner ${note.type === 'good' ? 'bannerGood' : 'bannerBad'}`}>{note.text}</p>}
      <section className="card">
        <h2>Your Instagram account</h2>
        {settings.email && <p className="muted">Signed in as {settings.email}</p>}
        {settings.connected ? (
          <div className={styles.status}>
            <span className="chip chipGood">Connected</span>
            <strong>@{settings.username}</strong>
            <small>Account ID {settings.igUserId}</small>
          </div>
        ) : (
          <p className="muted">Connect the Instagram account whose reels DMBot should answer. It must be a public Professional (Creator or Business) account that the DMBot owner has added as a tester.</p>
        )}
        {settings.connected && left != null && (
          <p className={left < 7 ? 'banner bannerBad' : 'muted'}>
            Access expires around {formatDate(settings.tokenExpiresAt)} ({left} days). It renews automatically.
          </p>
        )}
        <button className="btnPrimary" onClick={connect} disabled={busy}>
          {busy ? 'Opening Instagram…' : settings.connected ? 'Reconnect Instagram' : 'Connect Instagram'}
        </button>
      </section>

      <details className={`card ${styles.advanced}`}>
        <summary>Advanced</summary>
        <form onSubmit={saveToken} className={styles.advancedBody}>
          <h2>Paste an access token</h2>
          <p className="muted">Only if Connect Instagram doesn't work: generate a token in the Meta developer dashboard (Instagram → API setup with Instagram login → Generate token) and paste it here.</p>
          <div className="field">
            <label htmlFor="token">Access token</label>
            <input id="token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="IGAA…" />
          </div>
          <button className="btnGhost" disabled={busy || !token.trim()}>{busy ? 'Checking…' : 'Save token'}</button>
          <h2 className={styles.webhookTitle}>Webhook</h2>
          <p className="muted">Callback URL for the Meta dashboard (comments and messages fields):</p>
          <div className={styles.copyRow}>
            <code className={styles.url}>{webhookUrl}</code>
            <button type="button" className="btnGhost" onClick={() => navigator.clipboard && navigator.clipboard.writeText(webhookUrl)}>Copy</button>
          </div>
        </form>
      </details>
    </>
  );
}
