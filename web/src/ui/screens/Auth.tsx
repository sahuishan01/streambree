import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../../api/rest';
import { useToast } from '../toast';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const api = new ApiClient(SERVER);
  const { toast } = useToast();

  async function run() {
    setMsg(''); setLoading(true);
    try {
      const res = await api.login(email, password);
      if (res.must_change_password) {
        toast('info', 'Please set a new password before continuing');
        navigate('/profile?first_login=1');
      } else {
        toast('success', 'Signed in');
        navigate('/channels');
      }
    } catch {
      setMsg('Incorrect email or password.');
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
            <input id="email" className="input" type="email" value={email} autoComplete="email"
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              onKeyDown={(e) => e.key === 'Enter' && run()} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">Password</label>
            <div className="pw-wrap">
              <input id="password" className="input" type={showPw ? 'text' : 'password'} value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && run()} />
              <button className="pw-toggle" type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>
          {msg && <div className="alert alert-error" role="alert">{msg}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }}
            onClick={run} disabled={loading || password.length < 1}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
