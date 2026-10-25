import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, truncate } from '../lib/format';
import styles from './Reels.module.css';

export default function Reels({ settings }) {
  const [reels, setReels] = useState(null);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!settings.connected) return;
    api.getReels().then((d) => setReels(d.reels)).catch((e) => setError(e.message));
  }, [settings.connected]);

  async function find(e) {
    e.preventDefault();
    setFinding(true);
    setFindError('');
    try {
      const { reel } = await api.resolveReel(link.trim());
      navigate(`/reels/${reel.id}`, { state: { reel } });
    } catch (err) {
      setFindError(err.message);
    } finally {
      setFinding(false);
    }
  }

  if (!settings.connected) {
    return <p className="banner bannerWarn">Connect your Instagram account in <Link to="/settings">Settings</Link> first.</p>;
  }

  return (
    <>
      <h1>Your reels</h1>
      <p className="muted">Pick a reel to set its keywords. When someone comments exactly a keyword, they get your DM and a public reply.</p>

      <form className={`card ${styles.find}`} onSubmit={find}>
        <label htmlFor="link">Or paste a reel link</label>
        <div className={styles.findRow}>
          <input id="link" type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" />
          <button className="btnPrimary" disabled={finding || !link.trim()}>{finding ? 'Finding…' : 'Open'}</button>
        </div>
        {findError && <p className={`banner bannerBad ${styles.findErr}`}>{findError}</p>}
      </form>

      {error && <p className="banner bannerBad">{error}</p>}
      {!error && reels === null && <p className="muted">Loading reels…</p>}
      {reels && reels.length === 0 && <p className="empty">No reels found on @{settings.username}.</p>}
      {reels && reels.length > 0 && (
        <div className={styles.grid}>
          {reels.map((r) => (
            <Link key={r.id} to={`/reels/${r.id}`} state={{ reel: r }} className={styles.tile}>
              <div className={styles.thumb}>
                {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>Reel</span>}
                {r.ruleCount > 0 && <span className={`chip chipAccent ${styles.count}`}>{r.ruleCount} keyword{r.ruleCount > 1 ? 's' : ''}</span>}
              </div>
              <div className={styles.meta}>
                <span className={styles.caption}>{truncate(r.caption, 70) || 'No caption'}</span>
                <small>{formatDate(r.timestamp)}</small>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
