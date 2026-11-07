import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiClient } from '../../api/rest';
import { EmptyState, Notice } from '../components/ui';
import { BroadcastIcon } from '../components/icons';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function InviteAccept() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const signedIn = !!api.token;

  useEffect(() => {
    (async () => {
      const preview = await api.previewInvite(code);
      if (preview) setName(preview.name);
      else setError('This invite link has expired or was revoked. Ask the channel owner for a new one.');
    })();
  }, [code]);

  async function join() {
    setJoining(true);
    const res = await api.acceptInvite(code);
    if (res) nav(`/channels/${res.channel_id}`);
    else { setError('This invite link has expired or was revoked. Ask the channel owner for a new one.'); setJoining(false); }
  }

  return (
    <div className="page page-narrow">
      <div className="panel">
        {error ? (
          <EmptyState title="Invite unavailable" desc={error}
            action={<Link to="/" className="btn btn-secondary">Go home</Link>} />
        ) : !name ? (
          <div className="loading"><div className="spinner" aria-hidden="true" /> Checking invite…</div>
        ) : (
          <div className="stack" style={{ textAlign: 'center', alignItems: 'center', paddingBlock: 'var(--sp-4)' }}>
            <BroadcastIcon width={28} height={28} style={{ color: 'var(--accent)' }} />
            <div className="stack-sm">
              <span className="eyebrow">Channel invite</span>
              <h1 style={{ fontSize: 'var(--fs-2xl)' }}>{name}</h1>
              <p className="muted small">You’ve been invited to watch and stream in this channel.</p>
            </div>
            {signedIn ? (
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={join} disabled={joining}>
                {joining ? 'Joining…' : 'Accept invite'}
              </button>
            ) : (
              <>
                <Notice tone="info">Sign in first, then you’ll come back here to accept.</Notice>
                <Link to={`/auth?redirect=${encodeURIComponent(`/invite/${code}`)}`} className="btn btn-primary btn-lg btn-block">
                  Sign in to accept
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
