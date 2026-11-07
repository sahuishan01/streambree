import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiClient } from '../../api/rest';
import { useToast } from '../toast';
import { Notice } from '../components/ui';
import { LogoMark } from '../components/icons';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

/** Only allow same-origin paths so the redirect param can't send people off-site. */
function safeRedirect(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/channels';
}

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const api = new ApiClient(SERVER);
  const { toast } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setLoading(true);
    try {
      await api.login(email, password);
      toast('success', 'Signed in');
      navigate(safeRedirect(params.get('redirect')));
    } catch {
      setMsg('That email and password don’t match an account.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page page-narrow">
      <div className="stack-sm" style={{ alignItems: 'center', textAlign: 'center', marginBottom: 'var(--sp-6)' }}>
        <LogoMark width={36} height={36} style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: 'var(--fs-2xl)' }}>Sign in to Streambree</h1>
        <p className="muted small">Accounts are created by the server owner.</p>
      </div>

      <form className="panel stack" onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" className="input" type="email" value={email}
            autoComplete="email" autoFocus required
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <div className="pw-wrap">
            <input id="password" name="password" className="input" type={showPw ? 'text' : 'password'}
              value={password} autoComplete="current-password" required
              onChange={(e) => setPassword(e.target.value)} />
            <button className="pw-toggle" type="button" onClick={() => setShowPw((s) => !s)}
              aria-pressed={showPw} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        <button type="submit" className="btn btn-primary btn-lg btn-block"
          disabled={loading || !email || password.length < 1}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
