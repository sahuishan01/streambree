import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../../api/rest';
import { SkeletonPage } from '../Skeleton';
import { EmptyState, Notice, PageHead } from '../components/ui';
import { LockIcon } from '../components/icons';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const PW_MIN = 8;
interface User { id: string; email: string; created_at: string; }

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const nav = useNavigate();
  const api = new ApiClient(SERVER);

  useEffect(() => {
    if (!api.token) { nav('/auth'); return; }
    void init();
  }, []);

  async function init() {
    try {
      const me = await api.me();
      if (!me) { nav('/auth'); return; }
      setIsOwner(me.is_owner);
      if (me.is_owner) await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function refresh() { setUsers(await api.listUsers()); }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!email || password.length < PW_MIN) return;
    setSaving(true);
    const ok = await api.createUser(email, password);
    setSaving(false);
    if (ok) {
      setMsg({ tone: 'success', text: `${email} can now sign in. Share the temporary password with them; they’ll be asked to change it.` });
      setEmail(''); setPassword('');
      await refresh();
    } else {
      setMsg({ tone: 'error', text: 'Could not add that user. The email may already be in use.' });
    }
  }

  async function remove(id: string, userEmail: string) {
    if (!confirm(`Delete ${userEmail}? They will lose access immediately. This cannot be undone.`)) return;
    await api.deleteUser(id);
    await refresh();
  }

  if (loading) return <SkeletonPage />;

  if (!isOwner) return (
    <div className="page page-narrow">
      <div className="panel">
        <EmptyState icon={<LockIcon />} title="Owner access only"
          desc="Only the server owner can add or remove accounts." />
      </div>
    </div>
  );

  return (
    <div className="page page-form">
      <PageHead title="Users" desc="Everyone who can sign in to this Streambree server." back={{ to: '/profile', label: 'Profile' }} />

      <div className="stack">
        <form className="panel stack" onSubmit={add} aria-labelledby="add-user-title">
          <h2 className="panel-title" id="add-user-title">Add a user</h2>
          <div className="field">
            <label className="label" htmlFor="new-email">Email</label>
            <input id="new-email" className="input" type="email" value={email} autoComplete="off"
              onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="field">
            <label className="label" htmlFor="new-password">Temporary password</label>
            <input id="new-password" className="input" type="password" value={password} autoComplete="new-password"
              aria-describedby="new-password-hint" onChange={(e) => setPassword(e.target.value)} />
            <p id="new-password-hint" className="hint">At least {PW_MIN} characters.</p>
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={saving || !email || password.length < PW_MIN}>
              {saving ? 'Adding…' : 'Add user'}
            </button>
          </div>
        </form>

        <section className="panel panel-flush" aria-labelledby="all-users-title">
          <div className="panel-head">
            <h2 className="panel-title" id="all-users-title">All users <span className="count">{users.length}</span></h2>
          </div>
          <ul className="list">
            {users.map((u) => (
              <li key={u.id} className="list-row">
                <div className="avatar" aria-hidden="true">{(u.email[0] ?? '?').toUpperCase()}</div>
                <div className="list-main">
                  <span className="list-title truncate" style={{ fontSize: 'var(--fs-md)' }}>{u.email}</span>
                  <span className="list-meta">Joined {dateFmt.format(new Date(u.created_at))}</span>
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(u.id, u.email)}
                  aria-label={`Delete ${u.email}`}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
