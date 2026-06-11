import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera, captureFile, isAudioFile, keepFileAlive, requestWakeLock, releaseWakeLock } from '../../core/sources';
import { useSession } from '../hooks/useSession';
import { useToast } from '../toast';

type SourceKind = 'screen' | 'camera' | 'file';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';
const canShareScreen = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

export default function Sender() {
  const nav = useNavigate();
  useEffect(() => { if (!localStorage.getItem('sl_token')) nav('/auth'); }, []);
  const [source, setSource] = useState<SourceKind>(canShareScreen ? 'screen' : 'file');
  const [mode, setMode] = useState<Mode>('realtime');
  const [room, setRoom] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [stream, setStream] = useState<MediaStream | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [noAudio, setNoAudio] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const fileAudioRef = useRef<HTMLAudioElement>(null);
  const keepAliveRef = useRef<(() => void) | null>(null);
  const { state } = useSession(WS, 'sender', mode, room, stream);
  const { toast } = useToast();

  useEffect(() => {
    if (!room) {
      releaseWakeLock();
      keepAliveRef.current?.();
      keepAliveRef.current = null;
    }
  }, [room]);

  const audioOnly = file ? isAudioFile(file) : false;

  async function capture(): Promise<MediaStream> {
    if (source === 'camera') return captureCamera();
    if (source === 'file') {
      if (!file) throw new Error('Choose a file first.');
      if (audioOnly) {
        if (!fileAudioRef.current) throw new Error('No audio element.');
        return captureFile(file, fileAudioRef.current);
      }
      if (!fileVideoRef.current) throw new Error('No video element.');
      return captureFile(file, fileVideoRef.current);
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
      setCode(c); setRoom(c); setError(''); setCopied(false);
      void requestWakeLock();
      if (source === 'file') {
        const el = audioOnly ? fileAudioRef.current : fileVideoRef.current;
        if (el) keepAliveRef.current = keepFileAlive(el);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start capture.');
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast('success', 'Room code copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('error', 'Could not copy code');
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
            {(['screen','camera','file'] as SourceKind[])
              .filter((s) => s !== 'screen' || canShareScreen)
              .map((s) => (
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
              <input className="input" type="file"
                accept="video/*,audio/*,.mkv,.mp4,.webm,.avi,.mov,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.aiff"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-2)' }}>
                  {audioOnly ? '🎵' : '🎬'} {file.name}
                </div>
              )}
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
        {noAudio && (
          <div className="alert alert-warning">
            No audio track — viewers will hear no sound. For screen share, enable "Share audio".
            For files, convert AC3/DTS to AAC.
          </div>
        )}

        {!room ? (
          <button className="btn btn-primary btn-lg" onClick={createSession}>Create session</button>
        ) : (
          <div className="card">
            <div className="card-title">Share this code</div>
            <div className="copy-row" style={{ marginBottom: '0.75rem' }}>
              <input className="input" readOnly value={code} style={{ letterSpacing: '0.1em', textAlign: 'center', fontSize: '1.125rem' }} />
              <button className="btn btn-primary" onClick={copyCode}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="row" style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>
              <span className={`chip${state.conn === 'connected' ? ' chip-live' : ''}`}>
                {state.conn === 'connected' && <span className="live-dot" />}
                {state.conn}
              </span>
              {state.transport !== 'unknown' && <span className="chip">{state.transport}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Audio-only file player — persistent so captureStream() stays alive */}
      <audio
        ref={fileAudioRef}
        controls={!!room && source === 'file' && audioOnly}
        style={
          source === 'file' && audioOnly
            ? { display: 'block', width: '100%', marginTop: '1rem' }
            : { position: 'fixed', left: '-9999px', width: '1px', height: '1px' }
        }
      />

      {/* Video file player */}
      <video
        ref={fileVideoRef}
        playsInline
        controls={!!room && source === 'file' && !audioOnly}
        style={
          source === 'file' && !audioOnly
            ? { display: 'block', width: '100%', marginTop: '1rem', borderRadius: 'var(--r-lg)' }
            : { position: 'fixed', left: '-9999px', width: '1px', height: '1px' }
        }
      />
    </div>
  );
}
