import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BroadcastViewer } from '../../core/broadcast-session';
import type { Transport } from '../../core/connection-machine';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

const DEFAULT_GAIN = 1.2;

export default function Watch() {
  const { code = '' } = useParams();
  const videoRef  = useRef<HTMLVideoElement>(null);
  const audioCtx   = useRef<AudioContext | null>(null);
  const gainNode   = useRef<GainNode | null>(null);
  const compressor = useRef<DynamicsCompressorNode | null>(null);
  const limiter    = useRef<DynamicsCompressorNode | null>(null);
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

    // Stage 1 — compressor: reduces loud sustained sounds (music, ambience)
    // more than sharp transients (hits, impacts), closing the dynamic range gap.
    // 4:1 ratio with soft knee is transparent but audibly evens out the mix.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;  // engage on most programme material
    comp.knee.value      =   6;  // soft knee — gradual, not abrupt
    comp.ratio.value     =   4;  // 4:1 gentle compression
    comp.attack.value    = 0.003; // 3 ms — lets transients through first
    comp.release.value   = 0.25; // 250 ms natural release
    compressor.current = comp;

    // Stage 2 — makeup gain: restore loudness lost to compression.
    const gn = ctx.createGain();
    gn.gain.value = DEFAULT_GAIN;
    gainNode.current = gn;

    // Stage 3 — limiter: brick-wall ceiling so nothing ever clips.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1;
    lim.knee.value      =  0;
    lim.ratio.value     = 20;
    lim.attack.value    = 0.001;
    lim.release.value   = 0.1;
    limiter.current = lim;

    const src = ctx.createMediaElementSource(el);
    src.connect(comp);
    comp.connect(gn);
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
