import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function InviteAccept() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    (async () => {
      const preview = await api.previewInvite(code);
      if (preview) setName(preview.name);
      else setError('This invite link is no longer valid.');
    })();
  }, [code]);

  async function join() {
    setJoining(true);
    const res = await api.acceptInvite(code);
    if (res) nav(`/channels/${res.channel_id}`);
    else setError('This invite link is no longer valid.');
  }

  return (
    <div className="page-narrow">
      <div className="auth-header">
        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📨</div>
        <h2>Channel invite</h2>
      </div>
      <div className="card" style={{ textAlign: 'center' }}>
        {error && <div className="alert alert-error">{error}</div>}
        {name && (
          <>
            <p style={{ color: 'var(--text-2)', marginBottom: '0.5rem' }}>You've been invited to join</p>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.375rem' }}>{name}</h3>
            <button className="btn btn-primary btn-lg" onClick={join} disabled={joining} style={{ width: '100%' }}>
              {joining ? 'Joining…' : 'Accept invite'}
            </button>
          </>
        )}
        {!name && !error && <div style={{ color: 'var(--text-2)' }}>Loading…</div>}
      </div>
      {!api.token && (
        <div className="auth-footer">
          Need an account?{' '}
          <a href={`/auth?redirect=/invite/${code}`}>Sign in</a>
        </div>
      )}
    </div>
  );
}
