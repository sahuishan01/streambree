import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Mode } from '../../core/protocol';
import { canShareScreen, captureScreen, captureCamera, captureFile } from '../../core/sources';
import { BroadcastSender } from '../../core/broadcast-session';
import { ApiClient } from '../../api/rest';

type SourceKind = 'screen' | 'camera' | 'file';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

export default function GoLive() {
  const { code = '' } = useParams();
  const screenSupported = canShareScreen();
  const [source, setSource] = useState<SourceKind>(screenSupported ? 'screen' : 'camera');
  const [mode, setMode] = useState<Mode>('realtime');
  const [file, setFile] = useState<File | null>(null);
  const [viewers, setViewers] = useState(0);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [noAudio, setNoAudio] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const senderRef = useRef<BroadcastSender | null>(null);
  const api = new ApiClient(SERVER);

  // Show local preview whenever we have a live stream
  useEffect(() => {
    if (previewRef.current && localStream) {
      previewRef.current.srcObject = localStream;
      previewRef.current.play().catch(() => {});
    }
  }, [localStream]);

  async function capture(): Promise<MediaStream> {
    if (source === 'camera') return captureCamera();
    if (source === 'file') {
      if (!file || !fileVideoRef.current) throw new Error('Choose a file first.');
      return captureFile(file, fileVideoRef.current as HTMLVideoElement & { captureStream?: () => MediaStream });
    }
    return captureScreen();
  }

  async function start() {
    setError('');
    try {
      const stream = await capture();
      setNoAudio(!stream.getAudioTracks().length);
      const ice = await api.turnCredentials();
      const sender = new BroadcastSender(WS, api.token ?? '', code, mode, stream, ice);
      sender.onViewerCount(setViewers);
      sender.onStopped(() => { setLive(false); setLocalStream(null); setError('Stream was stopped remotely.'); });
      sender.start();
      senderRef.current = sender;
      setLocalStream(stream);
      setLive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start stream.');
    }
  }

  function stop() {
    senderRef.current?.close();
    localStream?.getTracks().forEach((t) => t.stop());
    setLive(false);
    setLocalStream(null);
    setViewers(0);
  }

  const sources: { value: SourceKind; label: string }[] = [
    ...(screenSupported ? [{ value: 'screen' as SourceKind, label: '🖥 Screen' }] : []),
    { value: 'camera', label: '📷 Camera' },
    { value: 'file', label: '📁 File' },
  ];

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-header">
        <h2>Go live</h2>
        <p className="page-subtitle">Broadcast to your channel viewers</p>
      </div>

      {!live ? (
        <div className="form">
          <div className="card">
            <div className="card-title">Source</div>
            <div className="radio-group">
              {sources.map((s) => (
                <label key={s.value} className={`radio-opt${source === s.value ? ' checked' : ''}`}>
                  <input type="radio" name="src" checked={source === s.value} onChange={() => setSource(s.value)} />
                  {s.label}
                </label>
              ))}
            </div>
            {source === 'screen' && (
              <div className="alert alert-info" style={{ marginTop: '0.75rem' }}>
                Check "Share audio" or "Share tab audio" in the browser prompt to include sound.
              </div>
            )}
            {source === 'file' && (
              <div style={{ marginTop: '0.75rem' }}>
                <input className="input" type="file" accept="video/*,audio/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file && <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-2)' }}>📁 {file.name}</div>}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">Quality mode</div>
            <div className="radio-group">
              <label className={`radio-opt${mode === 'realtime' ? ' checked' : ''}`}>
                <input type="radio" name="mode" checked={mode === 'realtime'} onChange={() => setMode('realtime')} />
                ⚡ Real-time
              </label>
              <label className={`radio-opt${mode === 'quality' ? ' checked' : ''}`}>
                <input type="radio" name="mode" checked={mode === 'quality'} onChange={() => setMode('quality')} />
                🎬 High quality
              </label>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-lg" onClick={start}>Go live</button>
        </div>
      ) : (
        <div className="form">
          {/* Local preview — always visible while broadcasting */}
          <div className="video-wrap">
            <video ref={previewRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>

          <div className="card">
            <div className="row-spread">
              <div className="row">
                <span className="chip chip-live"><span className="live-dot" />Broadcasting</span>
                <span className="chip">{viewers} viewer{viewers !== 1 ? 's' : ''}</span>
              </div>
              <button className="btn btn-danger" onClick={stop}>Stop stream</button>
            </div>
            {noAudio && (
              <div className="alert alert-warning" style={{ marginTop: '0.75rem' }}>
                No audio track detected. For screen share, enable "Share audio". For files, convert AC3/DTS to AAC.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden element used by captureFile for Web Audio API processing */}
      <video ref={fileVideoRef} playsInline
        style={{ display: 'none' }} />
    </div>
  );
}
