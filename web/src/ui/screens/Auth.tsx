import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const navigate = useNavigate();
  const api = new ApiClient(SERVER);

  async function run(kind: 'login' | 'signup') {
    try {
      if (kind === 'login') await api.login(email, password);
      else await api.signup(email, password);
      navigate('/channels');
    } catch (e) {
      console.error('auth error:', e);
      setMsg('Authentication failed.');
    }
  }

  return (
    <main>
      <h2>Account</h2>
      <input aria-label="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input aria-label="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <button onClick={() => run('login')}>Log in</button>
      <button onClick={() => run('signup')}>Sign up</button>
      {msg && <p>{msg}</p>}
    </main>
  );
}
