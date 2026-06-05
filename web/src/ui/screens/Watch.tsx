import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BroadcastViewer } from '../../core/broadcast-session';
import type { Transport } from '../../core/connection-machine';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

const DEFAULT_GAIN = 1.5;

export default function Watch() {
  const { code = '' } = useParams();
  const videoRef  = useRef<HTMLVideoElement>(null);
  const audioCtx  = useRef<AudioContext | null>(null);
  const gainNode  = useRef<GainNode | null>(null);
  const limiter   = useRef<DynamicsCompressorNode | null>(null);
  const [transport, setTransport] = useState<Transport>('unknown');
  const [status, setStatus] = useState<'connecting'|'connected'|'ended'|'error'>('connecting');
  const [showUnmute, setShowUnmute] = useState(false);
  const [gain, setGain] = useState(DEFAULT_GAIN);

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
          el.muted = true;
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
    return () => {
      viewer?.close();
      audioCtx.current?.close();
    };
  }, [code]);

  function unmute() {
    const el = videoRef.current;
    if (!el) return;

    const ctx = new AudioContext();
    audioCtx.current = ctx;

    // Gain — modest boost to raise WebRTC volume to match local playback.
    const gn = ctx.createGain();
    gn.gain.value = DEFAULT_GAIN;
    gainNode.current = gn;

    // Limiter — catches peaks before they clip, preserving the balance
    // between transient effects (punches, explosions) and sustained sounds
    // (music, ambience). High ratio + fast attack = transparent brick wall.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2;   // engage above -2 dBFS
    lim.knee.value      =  0;   // hard knee — limiter not compressor
    lim.ratio.value     = 20;   // 20:1 ≈ brick-wall limiter
    lim.attack.value    = 0.001; // 1 ms — catches fast transients
    lim.release.value   = 0.15; // 150 ms release
    limiter.current = lim;

    const src = ctx.createMediaElementSource(el);
    src.connect(gn);
    gn.connect(lim);
    lim.connect(ctx.destination);

    el.muted = false;
    el.volume = 1;
    setShowUnmute(false);
  }

  function onGainChange(v: number) {
    setGain(v);
    if (gainNode.current) gainNode.current.gain.value = v;
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
        <video ref={videoRef} playsInline controls />
      </div>

      {status === 'connected' && !showUnmute && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
              🔊 Volume boost
            </span>
            <input type="range" min={1} max={5} step={0.1} value={gain}
              onChange={(e) => onGainChange(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--primary)' }} />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-2)', minWidth: '2.5rem', textAlign: 'right' }}>
              {gain.toFixed(1)}×
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
