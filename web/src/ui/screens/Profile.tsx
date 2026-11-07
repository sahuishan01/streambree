import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient } from '../../api/rest';
import { SkeletonPage } from '../Skeleton';
import { Notice, PageHead } from '../components/ui';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const PW_MIN = 8;
type Msg = { tone: 'success' | 'error'; text: string } | null;

export default function Profile() {
  const nav = useNavigate();
  const api = new ApiClient(SERVER);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nameMsg, setNameMsg] = useState<Msg>(null);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState<Msg>(null);

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
    setLoading(false);
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameMsg(null);
    try {
      await api.updateMe(username);
      setNameMsg({ tone: 'success', text: 'Display name saved.' });
    } catch {
      setNameMsg({ tone: 'error', text: 'Could not save the display name.' });
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < PW_MIN) { setPwMsg({ tone: 'error', text: `New password needs at least ${PW_MIN} characters.` }); return; }
    try {
      await api.changePassword(curPw, newPw);
      setCurPw(''); setNewPw('');
      setPwMsg({ tone: 'success', text: 'Password changed.' });
    } catch {
      setPwMsg({ tone: 'error', text: 'Your current password is incorrect.' });
    }
  }

  if (loading) return <SkeletonPage />;

  return (
    <div className="page page-form">
      <PageHead title="Profile" desc="Your account on this Streambree server." />

      <div className="stack">
        <section className="panel" aria-label="Account">
          <div className="spread">
            <div className="cluster" style={{ gap: 'var(--sp-4)', minWidth: 0 }}>
              <div className="avatar avatar-lg" aria-hidden="true">{(username[0] ?? email[0] ?? '?').toUpperCase()}</div>
              <div className="stack-sm" style={{ gap: 'var(--sp-1)', minWidth: 0 }}>
                <span className="list-title truncate" style={{ fontSize: 'var(--fs-lg)' }}>{username || email}</span>
                <span className="muted small truncate">{email}</span>
                <span><span className={`badge ${isOwner ? 'badge-owner' : ''}`}>{isOwner ? 'server owner' : 'member'}</span></span>
              </div>
            </div>
            {isOwner && <Link to="/users" className="btn btn-secondary btn-sm">Manage users</Link>}
          </div>
        </section>

        <form className="panel stack" onSubmit={saveName} aria-labelledby="name-title">
          <div className="panel-head-text">
            <h2 className="panel-title" id="name-title">Display name</h2>
            <p className="panel-desc">Shown to other members instead of your email.</p>
          </div>
          <div className="inline-form">
            <label className="visually-hidden" htmlFor="display-name">Display name</label>
            <input id="display-name" className="input" value={username} autoComplete="nickname" maxLength={60}
              onChange={(e) => { setUsername(e.target.value); setNameMsg(null); }} placeholder="Your name" />
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
          {nameMsg && <Notice tone={nameMsg.tone}>{nameMsg.text}</Notice>}
        </form>

        <form className="panel stack" onSubmit={savePassword} aria-labelledby="pw-title">
          <h2 className="panel-title" id="pw-title">Change password</h2>
          <div className="field">
            <label className="label" htmlFor="cur-pw">Current password</label>
            <input id="cur-pw" className="input" type="password" value={curPw} autoComplete="current-password"
              onChange={(e) => setCurPw(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="new-pw">New password</label>
            <input id="new-pw" className="input" type="password" value={newPw} autoComplete="new-password"
              aria-describedby="new-pw-hint" onChange={(e) => setNewPw(e.target.value)} />
            <p id="new-pw-hint" className="hint">At least {PW_MIN} characters.</p>
          </div>
          {pwMsg && <Notice tone={pwMsg.tone}>{pwMsg.text}</Notice>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={!curPw || newPw.length < PW_MIN}>
              Change password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
