import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { truncate } from '../lib/format';
import { keywordRows } from '../lib/keywords';
import styles from './Keywords.module.css';

export default function Keywords({ settings }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [reelsNote, setReelsNote] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    // Reels only add thumbnails; if Instagram fails, the list still shows with the saved captions.
    const [rulesRes, reelsRes] = await Promise.allSettled([api.getAllRules(), api.getReels()]);
    if (rulesRes.status === 'rejected') { setError(rulesRes.reason.message); return; }
    setReelsNote(reelsRes.status === 'rejected' ? `Couldn't load reel thumbnails: ${reelsRes.reason.message}` : '');
    setRows(keywordRows(rulesRes.value.rules, reelsRes.status === 'fulfilled' ? reelsRes.value.reels : null));
  }, []);

  useEffect(() => { if (settings.connected) load(); }, [settings.connected, load]);

  async function run(rule, fn) {
    setBusyId(rule.id);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const toggle = (rule) => run(rule, () => api.updateRule(rule.id, { ...rule, enabled: !rule.enabled }));
  const remove = (rule) => {
    if (!window.confirm(`Delete the "${rule.keyword}" keyword?`)) return;
    run(rule, () => api.deleteRule(rule.id));
  };

  if (!settings.connected) {
    return <p className="banner bannerWarn">Connect your Instagram account in <Link to="/settings">Settings</Link> first.</p>;
  }

  const active = rows ? rows.filter((r) => r.rule.enabled).length : 0;

  return (
    <>
      <h1>Keywords</h1>
      {rows && rows.length > 0 && <p className="muted">{active} active · {rows.length - active} paused · across all reels</p>}
      {error && <p className="banner bannerBad">{error}</p>}
      {reelsNote && <p className="banner bannerWarn">{reelsNote}</p>}
      {rows === null && !error && <p className="muted">Loading keywords…</p>}
      {rows && rows.length === 0 && (
        <p className="empty">No keywords yet. Pick a reel on the <Link to="/reels">Reels</Link> page to add one.</p>
      )}
      {rows && rows.map(({ rule, reel }) => (
        <div key={rule.id} className={`card ${styles.row} ${rule.enabled ? '' : styles.paused}`}>
          <div className={styles.thumb}>
            {reel.thumbnailUrl ? <img src={reel.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>Reel</span>}
          </div>
          <div className={styles.body}>
            <div className={styles.head}>
              <span className={styles.keyword}>{rule.keyword}</span>
              <span className={`chip ${rule.enabled ? 'chipGood' : ''}`}>{rule.enabled ? 'Active' : 'Paused'}</span>
            </div>
            <p className={styles.caption}>{truncate(reel.caption, 80) || 'No caption'}</p>
            <p className={styles.dm}>{rule.gateText ? `Follow-gate: ${truncate(rule.gateText, 70)}` : 'No follow-gate yet (sends the DM directly)'}</p>
            <p className={styles.dm}>DM: {truncate(rule.dmText, 90)}</p>
            <div className="row">
              <button className="btnGhost" disabled={busyId === rule.id} onClick={() => toggle(rule)}>{rule.enabled ? 'Pause' : 'Resume'}</button>
              <Link className={`btnGhost ${styles.open}`} to={`/reels/${rule.mediaId}`} state={{ reel }}>Open reel</Link>
              <button className="btnDanger" disabled={busyId === rule.id} onClick={() => remove(rule)}>Delete</button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
