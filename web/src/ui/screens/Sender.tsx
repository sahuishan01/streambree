import { useRef, useState } from 'react';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera, captureFile } from '../../core/sources';
import { useSession } from '../hooks/useSession';

type SourceKind = 'screen' | 'camera' | 'file';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';

export default function Sender() {
  const [source, setSource] = useState<SourceKind>('screen');
  const [mode, setMode] = useState<Mode>('realtime');
  const [room, setRoom] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [stream, setStream] = useState<MediaStream | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [noAudio, setNoAudio] = useState(false);
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const { state } = useSession(WS, 'sender', mode, room, stream);

  async function capture(): Promise<MediaStream> {
    if (source === 'camera') return captureCamera();
    if (source === 'file') {
      if (!file) throw new Error('Choose a file first.');
      const el = fileVideoRef.current;
      if (!el) throw new Error('No preview element.');
      return captureFile(file, el as HTMLVideoElement & { captureStream?: () => MediaStream });
    }
    return captureScreen();
  }

  function makeCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(10);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => a[n % a.length]).join('');
  }

  async function createSession() {
    try {
      const captured = await capture();
      setNoAudio(!captured.getAudioTracks().length);
      setStream(captured);
      const c = makeCode();
      setCode(c); setRoom(c); setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start capture.');
    }
  }

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-header">
        <h2>Start streaming</h2>
        <p className="page-subtitle">One-to-one peer-to-peer stream</p>
      </div>

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
        {noAudio && <div className="alert alert-warning">No audio track — viewers will hear no sound. For screen share, enable "Share audio". For files, convert AC3/DTS to AAC.</div>}

        {!room ? (
          <button className="btn btn-primary btn-lg" onClick={createSession}>Create session</button>
        ) : (
          <div className="card">
            <div className="card-title">Share this code</div>
            <div className="code-block" style={{ fontSize: '1.25rem', letterSpacing: '0.1em', textAlign: 'center', padding: '1rem' }}>{code}</div>
            <div className="row" style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-2)' }}>
              <span className={`chip${state.conn === 'connected' ? ' chip-live' : ''}`}>
                {state.conn === 'connected' && <span className="live-dot" />}
                {state.conn}
              </span>
              {state.transport !== 'unknown' && <span className="chip">{state.transport}</span>}
            </div>
          </div>
        )}
      </div>

      <video ref={fileVideoRef} playsInline
        style={{
          marginTop: '1rem', borderRadius: 'var(--r-lg)', width: '100%',
          ...(source !== 'file' || room ? { position: 'fixed', left: '-9999px', width: '1px', height: '1px' } : {}),
        }} />
    </div>
  );
}
