import { useState } from 'react';
import styles from './RuleForm.module.css';

const DM_MAX = 1000;
const GATE_MAX = 800;

// Controlled form for one keyword rule. onSubmit(form) returns a promise; errors are shown by the parent.
export default function RuleForm({ initial, submitLabel, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(initial);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
      <div className="field">
        <label htmlFor="kw">Keyword<span className="hint">The whole comment must be this word or phrase. Capitals and extra spaces don't matter.</span></label>
        <input id="kw" type="text" maxLength={100} value={form.keyword} onChange={(e) => set({ keyword: e.target.value })} placeholder="LINK" />
      </div>
      <div className="field">
        <label htmlFor="gate">Follow-gate message<span className="hint">Sent first, right after they comment. Ask them to follow you. It comes with an “I followed ✅” button, and if it doesn't mention DONE, a line “After following, tap I followed ✅ or reply DONE” is added.</span></label>
        <textarea id="gate" maxLength={GATE_MAX} value={form.gateText} onChange={(e) => set({ gateText: e.target.value })} placeholder="Follow @your_account to unlock the details 🔓" />
        <small className={styles.count}>{form.gateText.length}/{GATE_MAX}</small>
      </div>
      <div className="field">
        <label htmlFor="dm">Real DM (after they follow)<span className="hint">Sent only once Instagram confirms they follow you. Links are fine.</span></label>
        <textarea id="dm" maxLength={DM_MAX} value={form.dmText} onChange={(e) => set({ dmText: e.target.value })} placeholder="Here's the link you asked for: https://…" />
        <small className={styles.count}>{form.dmText.length}/{DM_MAX}</small>
      </div>
      <p className={styles.note}>The public reply is picked automatically from a set like “Check your DMs! 📩” and “DM sent! 💌”, never the same twice in a row.</p>
      <label className={styles.toggle}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Active
      </label>
      <div className="row">
        <button className="btnPrimary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btnGhost" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}
