import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const api = new ApiClient(SERVER);

  async function run(kind: 'login' | 'signup') {
    setMsg(''); setLoading(true);
    try {
      if (kind === 'login') await api.login(email, password);
      else await api.signup(email, password);
      navigate('/channels');
    } catch {
      setMsg(kind === 'login' ? 'Incorrect email or password.' : 'Could not create account — email may already be taken.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-narrow">
      <div className="auth-header">
        <div className="auth-brand">Streambree</div>
        <div className="auth-sub">Sign in to your account</div>
      </div>

      <div className="card">
        <div className="form">
          <div className="field">
            <label className="field-label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              onKeyDown={(e) => e.key === 'Enter' && run('login')} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && run('login')} />
          </div>
          {msg && <div className="alert alert-error">{msg}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }}
            onClick={() => run('login')} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </div>

      <div className="auth-footer">
        Don't have an account?{' '}
        <button className="btn btn-ghost btn-sm" onClick={() => run('signup')} disabled={loading}>
          Sign up
        </button>
      </div>
    </div>
  );
}
