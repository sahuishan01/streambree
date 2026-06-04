import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

interface User { id: string; email: string; created_at: string; }

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const navigate = useNavigate();
  const api = new ApiClient(SERVER);

  useEffect(() => {
    if (!api.token) { navigate('/auth'); return; }
    void init();
  }, []);

  async function init() {
    const me = await api.me();
    if (!me) { navigate('/auth'); return; }
    setIsOwner(me.is_owner);
    if (me.is_owner) await refresh();
  }

  async function refresh() {
    setUsers(await api.listUsers());
  }

  async function add() {
    setMsg('');
    if (!email || password.length < 8) {
      setMsg('Email required and password must be at least 8 characters.');
      return;
    }
    const ok = await api.createUser(email, password);
    if (ok) {
      setEmail('');
      setPassword('');
      setMsg('User added.');
      await refresh();
    } else {
      setMsg('Failed — email may already be taken.');
    }
  }

  async function remove(id: string, userEmail: string) {
    if (!confirm(`Delete user ${userEmail}?`)) return;
    await api.deleteUser(id);
    await refresh();
  }

  if (!isOwner) {
    return <main><p>Access denied.</p></main>;
  }

  return (
    <main>
      <h2>Users</h2>

      <h3>Add user</h3>
      <input
        aria-label="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email"
      />
      <input
        aria-label="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password (min 8 chars)"
      />
      <button onClick={add}>Add</button>
      {msg && <p>{msg}</p>}

      <h3>Existing users</h3>
      <ul>
        {users.map((u) => (
          <li key={u.id}>
            {u.email} <small>({new Date(u.created_at).toLocaleDateString()})</small>
            {' '}<button onClick={() => remove(u.id, u.email)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
