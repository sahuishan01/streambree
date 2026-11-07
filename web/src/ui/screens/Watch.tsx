import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BroadcastViewer } from '../../core/broadcast-session';
import type { Transport } from '../../core/connection-machine';
import { ApiClient } from '../../api/rest';
import { PageHead, TransportStatus } from '../components/ui';
import { MuteIcon, VolumeIcon } from '../components/icons';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

type WatchStatus = 'connecting' | 'connected' | 'ended' | 'error';

const STATUS: Record<WatchStatus, { label: string; tone: string; detail: string }> = {
  connecting: { label: 'Connecting', tone: '', detail: 'Joining the broadcast…' },
  connected: { label: 'Live', tone: 'status-live', detail: '' },
  ended: { label: 'Ended', tone: 'status-plain', detail: 'The broadcaster ended this stream.' },
  error: { label: 'Offline', tone: 'status-bad', detail: 'Could not reach the stream. It may not be live yet.' },
};

export default function Watch() {
  const { code = '' } = useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLVideoElement>(null);
  const [transport, setTransport] = useState<Transport>('unknown');
  const [status, setStatus] = useState<WatchStatus>('connecting');
  const [showUnmute, setShowUnmute] = useState(false);
  const [hasCam, setHasCam] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(true);

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

          const videos = s.getVideoTracks();
          const multiCam = videos.length > 1;
          setHasCam(multiCam);
          if (multiCam && pipRef.current) {
            pipRef.current.srcObject = new MediaStream([videos[1]]);
            pipRef.current.play().catch(() => {});
          }

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
    return () => { viewer?.close(); };
  }, [code]);

  function unmute() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = volume || 1;
    if (!volume) setVolume(1);
    setMuted(false);
    setShowUnmute(false);
  }

  function changeVolume(v: number) {
    setVolume(v);
    const el = videoRef.current;
    if (!el) return;
    el.volume = v;
    if (v === 0) { el.muted = true; setMuted(true); }
    else { el.muted = false; setMuted(false); setShowUnmute(false); }
  }

  const info = STATUS[status];
  const silent = muted || volume === 0;

  return (
    <div className="page">
      <PageHead title="Watching" back={{ to: '/channels', label: 'Channels' }}>
        <div className="cluster">
          <span className={`status ${info.tone}`}>{info.label}</span>
          <TransportStatus transport={transport} />
        </div>
      </PageHead>

      <div className="stack">
        <div className="stage">
          {status !== 'connected' && (
            <div className="stage-overlay">
              {status === 'connecting' && <div className="spinner" aria-hidden="true" />}
              <div className="stage-overlay-title">{status === 'connecting' ? 'Connecting' : info.label}</div>
              <div className="small">{info.detail}</div>
            </div>
          )}
          {showUnmute && muted && (
            <div className="stage-overlay">
              <button type="button" className="btn btn-primary btn-lg" onClick={unmute}>
                <VolumeIcon /> Turn on sound
              </button>
            </div>
          )}
          <video ref={videoRef} playsInline controls aria-label="Live stream" />
          {hasCam && <video ref={pipRef} className="stage-pip" playsInline muted aria-label="Broadcaster webcam" />}
        </div>

        {status === 'connected' && (
          <div className="panel" style={{ paddingBlock: 'var(--sp-3)' }}>
            <div className="volume">
              <button type="button" className="btn btn-quiet btn-icon"
                aria-label={silent ? 'Unmute' : 'Mute'}
                onClick={() => (silent ? unmute() : changeVolume(0))}>
                {silent ? <MuteIcon /> : <VolumeIcon />}
              </button>
              <input type="range" min="0" max="1" step="0.05" value={silent ? 0 : volume}
                onChange={(e) => changeVolume(parseFloat(e.target.value))} aria-label="Volume" />
              <span className="volume-value" aria-hidden="true">{Math.round((silent ? 0 : volume) * 100)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
