import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../../api/rest';
import { SkeletonLine, SkeletonBlock } from '../Skeleton';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Profile() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const api = new ApiClient(SERVER);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [mustChangePw, setMustChangePw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nameMsg, setNameMsg] = useState('');
  const [nameMsgType, setNameMsgType] = useState<'success'|'error'>('success');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwMsgType, setPwMsgType] = useState<'success'|'error'>('success');

  useEffect(() => {
    if (!api.token) { nav('/auth'); return; }
    void init();
  }, []);

  async function init() {
    const me = await api.me();
    if (!me) { nav('/auth'); return; }
    setEmail(me.email);
    setUsername(me.username ?? '');
    setIsOwner(me.is_owner);
    const forceReset = Boolean(me.must_change_password || searchParams.get('first_login') === '1');
    setMustChangePw(forceReset);
    if (forceReset) {
      setPwMsg('Action required: Please change your temporary password to continue.');
      setPwMsgType('error');
    }
    setLoading(false);
  }

  async function saveName() {
    setNameMsg('');
    try {
      await api.updateMe(username);
      setNameMsg('Username updated.'); setNameMsgType('success');
    } catch {
      setNameMsg('Failed to update.'); setNameMsgType('error');
    }
  }

  async function savePassword() {
    setPwMsg('');
    if (newPw.length < 8) { setPwMsg('New password must be at least 8 characters.'); setPwMsgType('error'); return; }
    try {
      await api.changePassword(curPw, newPw);
      setCurPw(''); setNewPw('');
      setMustChangePw(false);
      setPwMsg('Password updated successfully. You are all set!'); setPwMsgType('success');
    } catch {
      setPwMsg('Incorrect current password.'); setPwMsgType('error');
    }
  }

  if (loading) return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="page-header">
        <SkeletonLine width="30%" />
        <SkeletonLine width="45%" />
      </div>
      <SkeletonBlock />
      <div style={{ height: '1rem' }} />
      <SkeletonBlock />
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="page-header">
        <h2>Profile</h2>
        <p className="page-subtitle">Manage your account settings</p>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ marginBottom: '1.25rem' }}>
          <div className="avatar avatar-lg">{(email[0] ?? '?').toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '1.0625rem' }}>{username || email}</div>
            <div style={{ color: 'var(--text-2)', fontSize: '0.875rem' }}>{email}</div>
            <div style={{ marginTop: '0.375rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span className={`badge ${isOwner ? 'badge-owner' : 'badge-member'}`}>
                {isOwner ? 'Owner' : 'Member'}
              </span>
              {isOwner && <Link to="/users" className="btn btn-ghost btn-sm">Manage users</Link>}
            </div>
          </div>
        </div>
        <div className="divider" />
        <div className="card-title">Display name</div>
        <div className="form-row">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="Your display name" onKeyDown={(e) => e.key === 'Enter' && saveName()} />
          <button className="btn btn-primary" onClick={saveName}>Save</button>
        </div>
        {nameMsg && <div className={`alert alert-${nameMsgType}`} style={{ marginTop: '0.625rem' }}>{nameMsg}</div>}
      </div>

      <div className="card">
        <div className="card-title">
          Change password
          {mustChangePw && <span className="badge badge-owner" style={{ marginLeft: '0.5rem', background: 'var(--red, #e05252)' }}>Required</span>}
        </div>
        {mustChangePw && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            <strong>First login security notice:</strong> You must update your initial password before proceeding.
          </div>
        )}
        <div className="form">
          <div className="field">
            <label className="field-label">Current password</label>
            <input className="input" type="password" value={curPw}
              onChange={(e) => setCurPw(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="field">
            <label className="field-label">New password</label>
            <input className="input" type="password" value={newPw}
              onChange={(e) => setNewPw(e.target.value)} placeholder="Min 8 characters" />
          </div>
          {pwMsg && <div className={`alert alert-${pwMsgType}`}>{pwMsg}</div>}
          <button className="btn btn-primary" onClick={savePassword}
            disabled={!curPw || newPw.length < 8}>
            Update password
          </button>
        </div>
      </div>
    </div>
  );
}
