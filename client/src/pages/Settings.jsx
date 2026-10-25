import { useState } from 'react';
import { api } from '../lib/api';
import { daysLeft, formatDate } from '../lib/format';
import styles from './Settings.module.css';

export default function Settings({ settings, onSaved }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { type: 'good' | 'bad', text }
  const webhookUrl = `${window.location.origin}/server/webhook/`;
  const left = daysLeft(settings.tokenExpiresAt);

  async function save(e) {
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
      <section className="card">
        <h2>Instagram account</h2>
        {settings.connected ? (
          <div className={styles.status}>
            <span className="chip chipGood">Connected</span>
            <strong>@{settings.username}</strong>
            <small>Account ID {settings.igUserId}</small>
          </div>
        ) : (
          <p className="banner bannerWarn">Not connected yet. Paste an access token below.</p>
        )}
        {settings.connected && left != null && (
          <p className={left < 7 ? 'banner bannerBad' : 'muted'}>
            Token expires around {formatDate(settings.tokenExpiresAt)} ({left} days). The weekly cron job refreshes it automatically.
          </p>
        )}
      </section>

      <form className="card" onSubmit={save}>
        <h2>{settings.connected ? 'Replace access token' : 'Connect with an access token'}</h2>
        <ol className={styles.steps}>
          <li>Open your app in the Meta developer dashboard → Instagram → API setup with Instagram login.</li>
          <li>Under “Generate access tokens”, add your Instagram account and click <em>Generate token</em>.</li>
          <li>Paste the token here. It is stored on the server and never shown again.</li>
        </ol>
        <div className="field">
          <label htmlFor="token">Access token</label>
          <input id="token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="IGAA…" />
        </div>
        {note && <p className={`banner ${note.type === 'good' ? 'bannerGood' : 'bannerBad'}`}>{note.text}</p>}
        <button className="btnPrimary" disabled={busy || !token.trim()}>{busy ? 'Checking…' : 'Save and connect'}</button>
      </form>

      <section className="card">
        <h2>Webhook</h2>
        <p className="muted">In the Meta dashboard, set this as the callback URL, use your WEBHOOK_VERIFY_TOKEN as the verify token, and subscribe to the <code>comments</code> field.</p>
        <div className={styles.copyRow}>
          <code className={styles.url}>{webhookUrl}</code>
          <button type="button" className="btnGhost" onClick={() => navigator.clipboard && navigator.clipboard.writeText(webhookUrl)}>Copy</button>
        </div>
      </section>
    </>
  );
}
