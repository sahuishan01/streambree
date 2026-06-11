import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../../api/rest';
import { SkeletonLine, SkeletonCard } from '../Skeleton';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
interface User { id: string; email: string; created_at: string; }

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success'|'error'>('success');
  const nav = useNavigate();
  const api = new ApiClient(SERVER);

  useEffect(() => {
    if (!api.token) { nav('/auth'); return; }
    void init();
  }, []);

  async function init() {
    const me = await api.me();
    if (!me) { nav('/auth'); return; }
    setIsOwner(me.is_owner);
    if (me.is_owner) await refresh();
    setLoading(false);
  }

  async function refresh() { setUsers(await api.listUsers()); }

  async function add() {
    setMsg('');
    if (!email || password.length < 8) {
      setMsg('Email required and password must be at least 8 characters.');
      setMsgType('error'); return;
    }
    const ok = await api.createUser(email, password);
    if (ok) {
      setEmail(''); setPassword('');
      setMsg(`${email} added successfully.`); setMsgType('success');
      await refresh();
    } else {
      setMsg('Failed — email may already be taken.'); setMsgType('error');
    }
  }

  async function remove(id: string, userEmail: string) {
    if (!confirm(`Delete ${userEmail}? This cannot be undone.`)) return;
    await api.deleteUser(id);
    await refresh();
  }

  if (!isOwner && !loading) return (
    <div className="page page-narrow" style={{ textAlign: 'center' }}>
      <div className="empty-state">
        <div className="empty-state-icon">🔒</div>
        <h3>Access denied</h3>
        <p style={{ color: 'var(--text-2)', marginTop: '0.5rem' }}>Only the owner can manage users.</p>
      </div>
    </div>
  );

  if (loading) return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-header">
        <SkeletonLine width="20%" />
        <SkeletonLine width="35%" />
      </div>
      <SkeletonCard />
      <div style={{ height: '1rem' }} />
      <SkeletonCard />
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-header">
        <h2>Users</h2>
        <p className="page-subtitle">Manage who can access Streambree</p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-title">Add user</div>
        <div className="form">
          <div className="field">
            <label className="field-label">Email</label>
            <input className="input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
          </div>
          <div className="field">
            <label className="field-label">Password</label>
            <input className="input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" />
          </div>
          {msg && <div className={`alert alert-${msgType}`}>{msg}</div>}
          <button className="btn btn-primary" onClick={add} disabled={!email || password.length < 8}>Add user</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">All users ({users.length})</div>
        <div className="user-list">
          {users.map((u) => (
            <div key={u.id} className="user-row">
              <div className="avatar">{(u.email[0] ?? '?').toUpperCase()}</div>
              <div className="user-row-info">
                <div className="user-row-email">{u.email}</div>
                <div className="user-row-date">Joined {new Date(u.created_at).toLocaleDateString()}</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => remove(u.id, u.email)}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
