import { useState } from 'react';
import { ApiClient } from '../../api/rest';
import { Modal, Notice } from '../components/ui';

interface Props {
  api: ApiClient;
  onSuccess: () => void;
}

const PW_MIN = 8;

export default function ForceResetModal({ api, onSuccess }: Props) {
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const mismatch = confirmPw.length > 0 && newPw !== confirmPw;

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!curPw) { setErr('Enter your current (temporary) password.'); return; }
    if (newPw.length < PW_MIN) { setErr(`New password needs at least ${PW_MIN} characters.`); return; }
    if (newPw !== confirmPw) { setErr('The new passwords don’t match.'); return; }
    if (newPw === curPw) { setErr('Choose a password different from the temporary one.'); return; }

    setLoading(true);
    try {
      await api.changePassword(curPw, newPw);
      onSuccess();
    } catch {
      setErr('Your current password is incorrect.');
    } finally {
      setLoading(false);
    }
  }

  // No onClose: the reset is required before using the app.
  return (
    <Modal title="Set a new password"
      desc="You signed in with a temporary password. Choose your own to continue.">
      <form onSubmit={handleReset} className="stack" noValidate>
        <div className="field">
          <label className="label" htmlFor="reset-cur">Temporary password</label>
          <input id="reset-cur" className="input" type="password" value={curPw} autoComplete="current-password"
            onChange={(e) => setCurPw(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="reset-new">New password</label>
          <input id="reset-new" className="input" type="password" value={newPw} autoComplete="new-password"
            aria-describedby="reset-new-hint" onChange={(e) => setNewPw(e.target.value)} required />
          <p id="reset-new-hint" className="hint">At least {PW_MIN} characters.</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="reset-confirm">Confirm new password</label>
          <input id="reset-confirm" className="input" type="password" value={confirmPw} autoComplete="new-password"
            aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'reset-confirm-err' : undefined}
            onChange={(e) => setConfirmPw(e.target.value)} required />
          {mismatch && <p id="reset-confirm-err" className="hint hint-error">Doesn’t match the new password.</p>}
        </div>

        {err && <Notice tone="error">{err}</Notice>}

        <button type="submit" className="btn btn-primary btn-lg btn-block"
          disabled={loading || !curPw || newPw.length < PW_MIN || newPw !== confirmPw}>
          {loading ? 'Saving…' : 'Save and continue'}
        </button>
      </form>
    </Modal>
  );
}
