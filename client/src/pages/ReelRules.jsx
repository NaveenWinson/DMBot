import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { emptyRule, ruleToForm, truncate } from '../lib/format';
import RuleForm from '../components/RuleForm.jsx';
import styles from './ReelRules.module.css';

export default function ReelRules() {
  const { mediaId } = useParams();
  const location = useLocation();
  const [reel, setReel] = useState((location.state && location.state.reel) || null);
  const [rules, setRules] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | rule id
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadRules = useCallback(() => api.getRules(mediaId).then((d) => setRules(d.rules)).catch((e) => setError(e.message)), [mediaId]);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => {
    if (reel && reel.id === mediaId) return;
    api.getReels().then((d) => setReel(d.reels.find((r) => r.id === mediaId) || { id: mediaId, caption: '', permalink: '' })).catch(() => {});
  }, [mediaId, reel]);

  useEffect(() => { if (rules && rules.length === 0) setEditing('new'); }, [rules]);

  async function save(form, id) {
    setBusy(true);
    setError('');
    const body = { ...form, mediaId, permalink: (reel && reel.permalink) || '', captionPreview: truncate(reel && reel.caption, 200) };
    try {
      if (id) await api.updateRule(id, body);
      else await api.createRule(body);
      setEditing(null);
      await loadRules();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule) {
    setBusy(true);
    setError('');
    try {
      await api.updateRule(rule.id, { ...rule, enabled: !rule.enabled });
      await loadRules();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule) {
    if (!window.confirm(`Delete the "${rule.keyword}" rule?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteRule(rule.id);
      await loadRules();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link to="/reels" className={styles.back}>← All reels</Link>
      <div className={`card ${styles.reel}`}>
        {reel && reel.thumbnailUrl && <img src={reel.thumbnailUrl} alt="" className={styles.thumb} referrerPolicy="no-referrer" />}
        <div>
          <h1 className={styles.title}>{truncate(reel && reel.caption, 90) || 'Reel'}</h1>
          {reel && reel.permalink && <a href={reel.permalink} target="_blank" rel="noreferrer">Open on Instagram ↗</a>}
        </div>
      </div>

      {error && <p className="banner bannerBad">{error}</p>}
      {rules === null && !error && <p className="muted">Loading keywords…</p>}

      {rules && rules.map((r) => (
        <section key={r.id} className="card">
          {editing === r.id ? (
            <RuleForm initial={ruleToForm(r)} submitLabel="Save changes" busy={busy} onSubmit={(f) => save(f, r.id)} onCancel={() => setEditing(null)} />
          ) : (
            <>
              <div className={styles.ruleHead}>
                <span className={styles.keyword}>{r.keyword}</span>
                <span className={`chip ${r.enabled ? 'chipGood' : ''}`}>{r.enabled ? 'Active' : 'Paused'}</span>
              </div>
              {r.gateText ? (
                <>
                  <p className={styles.label}>Follow-gate message (they reply DONE after following)</p>
                  <p className={styles.text}>{r.gateText}</p>
                </>
              ) : (
                <p className="banner bannerWarn">No follow-gate yet: this keyword sends the real DM straight away. Edit it to add a follow-gate message.</p>
              )}
              <p className={styles.label}>Real DM</p>
              <p className={styles.text}>{r.dmText}</p>
              <div className="row">
                <button className="btnGhost" disabled={busy} onClick={() => setEditing(r.id)}>Edit</button>
                <button className="btnGhost" disabled={busy} onClick={() => toggle(r)}>{r.enabled ? 'Pause' : 'Resume'}</button>
                <button className="btnDanger" disabled={busy} onClick={() => remove(r)}>Delete</button>
              </div>
            </>
          )}
        </section>
      ))}

      {rules && (editing === 'new' ? (
        <section className="card">
          <h2>New keyword</h2>
          <RuleForm initial={emptyRule()} submitLabel="Add keyword" busy={busy} onSubmit={(f) => save(f, null)} onCancel={rules.length ? () => setEditing(null) : null} />
        </section>
      ) : (
        <button className="btnPrimary" onClick={() => setEditing('new')} disabled={busy}>+ Add keyword</button>
      ))}
    </>
  );
}
