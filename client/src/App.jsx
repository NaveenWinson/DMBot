import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import AdminGate from './components/AdminGate.jsx';
import Reels from './pages/Reels.jsx';
import ReelRules from './pages/ReelRules.jsx';
import Keywords from './pages/Keywords.jsx';
import Activity from './pages/Activity.jsx';
import Settings from './pages/Settings.jsx';
import Privacy from './pages/Privacy.jsx';

const navClass = ({ isActive }) => (isActive ? 'active' : undefined);

export default function App() {
  return (
    <>
      <header className="nav">
        <Link to="/" className="brand">DM<span>Bot</span></Link>
        <nav className="navLinks">
          <NavLink to="/reels" className={navClass}>Reels</NavLink>
          <NavLink to="/keywords" className={navClass}>Keywords</NavLink>
          <NavLink to="/activity" className={navClass}>Activity</NavLink>
          <NavLink to="/settings" className={navClass}>Settings</NavLink>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/reels" element={<AdminGate>{(s) => <Reels settings={s} />}</AdminGate>} />
          <Route path="/reels/:mediaId" element={<AdminGate>{() => <ReelRules />}</AdminGate>} />
          <Route path="/keywords" element={<AdminGate>{(s) => <Keywords settings={s} />}</AdminGate>} />
          <Route path="/activity" element={<AdminGate>{() => <Activity />}</AdminGate>} />
          <Route path="/settings" element={<AdminGate>{(s, reload) => <Settings settings={s} onSaved={reload} />}</AdminGate>} />
          <Route path="*" element={<Navigate to="/reels" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        DMBot · keyword replies for your reels · <Link to="/privacy">Privacy</Link>
      </footer>
    </>
  );
}
