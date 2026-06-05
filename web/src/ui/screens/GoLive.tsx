import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera, captureFile } from '../../core/sources';
import { BroadcastSender } from '../../core/broadcast-session';
import { ApiClient } from '../../api/rest';

type SourceKind = 'screen' | 'camera' | 'file';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

export default function GoLive() {
  const { code = '' } = useParams();
  const [source, setSource] = useState<SourceKind>('screen');
  const [mode, setMode] = useState<Mode>('realtime');
  const [file, setFile] = useState<File | null>(null);
  const [viewers, setViewers] = useState(0);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [noAudio, setNoAudio] = useState(false);
  const [dbg, setDbg] = useState('');
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const senderRef = useRef<BroadcastSender | null>(null);
  const api = new ApiClient(SERVER);

  async function capture(): Promise<MediaStream> {
    if (source === 'camera') return captureCamera();
    if (source === 'file') {
      if (!file || !fileVideoRef.current) throw new Error('Choose a file first.');
      return captureFile(file, fileVideoRef.current as HTMLVideoElement & { captureStream?: () => MediaStream });
    }
    return captureScreen();
  }

  async function start() {
    setDbg(`source=${source} file=${file?.name ?? 'null'} capturing…`);
    try {
      const stream = await capture();
      const aTracks = stream.getAudioTracks().length;
      const vTracks = stream.getVideoTracks().length;
      setDbg(`source=${source} audio=${aTracks} video=${vTracks}`);
      setNoAudio(aTracks === 0);
      const ice = await api.turnCredentials();
      const sender = new BroadcastSender(WS, api.token ?? '', code, mode, stream, ice);
      sender.onViewerCount(setViewers);
      sender.onStopped(() => { setLive(false); setError('Stream was stopped remotely.'); });
      sender.start();
      senderRef.current = sender;
      setLive(true); setError('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDbg(`ERROR: ${msg}`);
      setError(msg);
    }
  }

  function stop() { senderRef.current?.close(); setLive(false); setViewers(0); }

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
              {(['screen','camera','file'] as SourceKind[]).map((s) => (
                <label key={s} className={`radio-opt${source === s ? ' checked' : ''}`}>
                  <input type="radio" name="src" checked={source === s} onChange={() => setSource(s)} />
                  {s === 'screen' ? '🖥 Screen' : s === 'camera' ? '📷 Camera' : '📁 File'}
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
          {dbg && <div className="alert alert-info" style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{dbg}</div>}
          <button className="btn btn-primary btn-lg" onClick={start}>Go live</button>
        </div>
      ) : (
        <>
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <div className="chip chip-live" style={{ display: 'inline-flex', marginBottom: '1.25rem' }}>
              <span className="live-dot" />Broadcasting
            </div>
            <div className="stat-bar" style={{ justifyContent: 'center', marginBottom: '1.5rem' }}>
              <div className="stat">
                <div className="stat-val">{viewers}</div>
                <div className="stat-lbl">Viewers</div>
              </div>
            </div>
            {noAudio && <div className="alert alert-warning" style={{ marginBottom: '1rem', textAlign: 'left' }}>
              No audio track — viewers hear no sound. For screen share, enable "Share audio" and restart.
              For files, check the codec (AC3/DTS unsupported; convert to AAC).
            </div>}
            <button className="btn btn-danger" onClick={stop}>Stop stream</button>
          </div>
        </>
      )}

      {/*
        Single persistent element — never unmounted so the ref and audio pipeline
        stay intact. Style switches between:
          - setup (not live, file selected): visible preview, no controls
          - live + file: visible player with controls so sender can seek/pause
          - anything else: 1px off-screen so Chrome keeps the audio pipeline running
      */}
      <video
        ref={fileVideoRef}
        playsInline
        controls={live && source === 'file'}
        style={
          source === 'file' && live
            ? { display: 'block', width: '100%', marginTop: '1rem', borderRadius: 'var(--r-lg)' }
            : source === 'file' && !live
            ? { display: 'block', width: '100%', marginTop: '1rem', borderRadius: 'var(--r-lg)' }
            : { position: 'fixed', left: '-9999px', width: '1px', height: '1px' }
        }
      />
    </div>
  );
}
