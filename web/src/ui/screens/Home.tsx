import { Link, useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();
  const loggedIn = !!localStorage.getItem('sl_token');

  function logout() {
    localStorage.removeItem('sl_token');
    navigate('/auth');
  }

  return (
    <div className="page">
      <div className="hero">
        <div className="hero-eyebrow">
          <span>⚡</span> Peer-to-peer streaming
        </div>
        <h1><span>Stream anything.</span><br />Share with anyone.</h1>
        <p className="hero-sub">
          Real-time screen, camera, and file streaming over WebRTC.
          Media flows device-to-device — the server only does signaling.
        </p>
        <div className="hero-cta">
          <Link to="/send" className="btn btn-primary btn-lg">Start streaming</Link>
          <Link to="/join" className="btn btn-ghost btn-lg">Join a stream</Link>
          {loggedIn
            ? <Link to="/channels" className="btn btn-ghost btn-lg">My channels</Link>
            : <Link to="/auth" className="btn btn-ghost btn-lg">Sign in</Link>}
        </div>
        {loggedIn && (
          <p style={{ marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--text-2)' }}>
            Signed in ·{' '}
            <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex' }} onClick={logout}>
              Sign out
            </button>
          </p>
        )}
      </div>

      <div className="features">
        <div className="feature-card">
          <div className="feature-icon">🖥️</div>
          <div className="feature-title">Screen sharing</div>
          <div className="feature-desc">Share your screen or a specific window with system audio capture.</div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📡</div>
          <div className="feature-title">Live broadcast</div>
          <div className="feature-desc">Stream to a channel — one broadcaster, unlimited viewers, all peer-to-peer.</div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🔒</div>
          <div className="feature-title">Private channels</div>
          <div className="feature-desc">Invite-only rooms with role-based access control and stream permissions.</div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📁</div>
          <div className="feature-title">File streaming</div>
          <div className="feature-desc">Stream any local video or audio file directly to connected viewers.</div>
        </div>
      </div>
    </div>
  );
}
