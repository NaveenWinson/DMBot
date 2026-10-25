import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { followLabel, formatDate } from '../lib/format';
import styles from './Activity.module.css';

const Status = ({ label, value }) => (
  <span className={`chip ${value === 'sent' ? 'chipGood' : value === 'failed' ? 'chipBad' : ''}`}>{label}: {value || '—'}</span>
);

export default function Activity() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api.getActivity().then((d) => setRows(d.activity)).catch((e) => setError(e.message)); };
  useEffect(load, []);

  return (
    <>
      <div className={styles.head}>
        <h1>Activity</h1>
        <button className="btnGhost" onClick={load}>Refresh</button>
      </div>
      <p className="muted">The last 100 comments that matched a keyword.</p>
      {error && <p className="banner bannerBad">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="empty">Nothing yet. Matching comments show up here.</p>}
      {rows && rows.map((r) => (
        <div key={r.id} className={`card ${styles.item}`}>
          <div className={styles.top}>
            <strong>@{r.fromUsername || 'unknown'}</strong>
            <span className={styles.comment}>“{r.commentText}”</span>
            <small className={styles.when}>{formatDate(r.createdAt)}</small>
          </div>
          <div className="row">
            <Status label="DM" value={r.dmStatus} />
            <Status label="Reply" value={r.replyStatus} />
            {followLabel(r.unlockStatus) && (
              <span className={`chip ${r.unlockStatus === 'sent' ? 'chipGood' : r.unlockStatus === 'expired' ? 'chipBad' : 'chipAccent'}`}>Follow: {followLabel(r.unlockStatus)}</span>
            )}
          </div>
          {r.replyText && <p className={styles.reply}>Replied: {r.replyText}</p>}
          {r.error && <p className={styles.error}>{r.error}</p>}
        </div>
      ))}
    </>
  );
}
