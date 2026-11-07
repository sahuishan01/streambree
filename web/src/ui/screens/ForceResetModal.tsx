import { useState } from 'react';
import { ApiClient } from '../../api/rest';

interface Props {
  api: ApiClient;
  onSuccess: () => void;
}

export default function ForceResetModal({ api, onSuccess }: Props) {
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!curPw) {
      setErr('Current password is required.');
      return;
    }
    if (newPw.length < 8) {
      setErr('New password must be at least 8 characters long.');
      return;
    }
    if (newPw !== confirmPw) {
      setErr('New passwords do not match.');
      return;
    }
    if (newPw === curPw) {
      setErr('New password must be different from current password.');
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(curPw, newPw);
      onSuccess();
    } catch {
      setErr('Incorrect current password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem',
    }}>
      <div className="card" style={{ maxWidth: 440, width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem' }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem'
          }}>🔒</div>
          <div>
            <div className="card-title" style={{ margin: 0 }}>Password Reset Required</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-2)' }}>
              For security, please change your temporary password before accessing the platform.
            </div>
          </div>
        </div>

        {err && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{err}</div>}

        <form onSubmit={handleReset} className="form">
          <div className="field">
            <label className="field-label">Current password</label>
            <input
              className="input"
              type="password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              placeholder="Enter current password"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label className="field-label">New password</label>
            <input
              className="input"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Min 8 characters"
              required
            />
          </div>
          <div className="field">
            <label className="field-label">Confirm new password</label>
            <input
              className="input"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Re-enter new password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem' }}
            disabled={loading || !curPw || newPw.length < 8 || newPw !== confirmPw}
          >
            {loading ? 'Updating password...' : 'Update password & continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
