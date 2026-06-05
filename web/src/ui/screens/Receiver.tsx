import { useEffect, useRef, useState } from 'react';
import { useSession } from '../hooks/useSession';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';

export default function Receiver() {
  const [input, setInput] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showUnmute, setShowUnmute] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state, remote } = useSession(WS, 'receiver', 'realtime', room);

  useEffect(() => {
    const el = videoRef.current;
    if (!remote || !el) return;
    el.srcObject = remote;
    el.muted = true;
    el.oncanplay = () => {
      el.oncanplay = null;
      el.play().catch(() => {});
      setShowUnmute(true);
    };
  }, [remote]);

  function unmute() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    setShowUnmute(false);
  }

  function join() {
    if (input.trim().length < 4) { setError('Enter a valid room code.'); return; }
    setError(''); setRoom(input.trim());
  }

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-header">
        <h2>Join a stream</h2>
        <p className="page-subtitle">Enter a room code to connect</p>
      </div>

      {!room ? (
        <div className="card">
          <div className="form">
            <div className="field">
              <label className="field-label">Room code</label>
              <input className="input" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '1.125rem' }}
                value={input} onChange={(e) => setInput(e.target.value.toUpperCase())}
                placeholder="XXXXXXXXXX" maxLength={10}
                onKeyDown={(e) => e.key === 'Enter' && join()} />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" onClick={join} disabled={input.trim().length < 4}>Join</button>
          </div>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <span className={`chip${state.conn === 'connected' ? ' chip-live' : ''}`}>
              {state.conn === 'connected' && <span className="live-dot" />}
              {state.conn}
            </span>
            {state.transport !== 'unknown' && <span className="chip">{state.transport}</span>}
          </div>
          <div className="video-wrap">
            {state.conn !== 'connected' && !remote && (
              <div className="video-overlay">
                <div style={{ color: 'var(--text-2)', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                  <div>Waiting for sender…</div>
                </div>
              </div>
            )}
            {showUnmute && (
              <div className="video-overlay">
                <button className="btn btn-primary btn-lg" onClick={unmute}>
                  🔊 Click to unmute
                </button>
              </div>
            )}
            <video ref={videoRef} playsInline controls />
          </div>
        </>
      )}
    </div>
  );
}
