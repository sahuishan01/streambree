import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BroadcastViewer } from '../../core/broadcast-session';
import type { Transport } from '../../core/connection-machine';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

export default function Watch() {
  const { code = '' } = useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [transport, setTransport] = useState<Transport>('unknown');
  const [status, setStatus] = useState<'connecting'|'connected'|'ended'|'error'>('connecting');
  const [showUnmute, setShowUnmute] = useState(false);

  useEffect(() => {
    let viewer: BroadcastViewer | null = null;
    (async () => {
      try {
        const api = new ApiClient(SERVER);
        const ice = await api.turnCredentials();
        viewer = new BroadcastViewer(WS, api.token ?? '', code, ice);
        viewer.onRemoteStream((s) => {
          const el = videoRef.current;
          if (!el) return;
          el.srcObject = s;
          el.muted = true; // muted so autoplay never gets blocked
          // Wait for enough data before calling play() — avoids AbortError
          el.oncanplay = () => {
            el.oncanplay = null;
            el.play().catch(() => {});
            setShowUnmute(true);
          };
          setStatus('connected');
        });
        viewer.onTransport(setTransport);
        viewer.onEnded(() => setStatus('ended'));
        viewer.start();
      } catch {
        setStatus('error');
      }
    })();
    return () => viewer?.close();
  }, [code]);

  function unmute() {
    const el = videoRef.current;
    if (el) { el.muted = false; el.volume = 1; }
    setShowUnmute(false);
  }

  const statusLabel = {
    connecting: 'Connecting…',
    connected: 'Live',
    ended: 'Stream ended',
    error: 'Could not connect',
  }[status];

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="row-spread page-header">
        <h2>Watching</h2>
        <div className="row">
          <span className={`chip${status === 'connected' ? ' chip-live' : ''}`}>
            {status === 'connected' && <span className="live-dot" />}
            {statusLabel}
          </span>
          {transport !== 'unknown' && <span className="chip">{transport}</span>}
        </div>
      </div>

      <div className="video-wrap">
        {status !== 'connected' && (
          <div className="video-overlay">
            <div style={{ textAlign: 'center', color: 'var(--text-2)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>
                {status === 'ended' ? '⏹' : status === 'error' ? '⚠️' : '⏳'}
              </div>
              <div>{statusLabel}</div>
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
        {/* No muted prop — controlled imperatively to avoid React re-render conflicts */}
        <video ref={videoRef} playsInline controls />
      </div>
    </div>
  );
}
