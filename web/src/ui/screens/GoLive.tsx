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
    try {
      const stream = await capture();
      const ice = await api.turnCredentials();
      const sender = new BroadcastSender(WS, api.token ?? '', code, mode, stream, ice);
      sender.onViewerCount(setViewers);
      sender.onStopped(() => { setLive(false); setError('Stream was stopped.'); });
      sender.start();
      senderRef.current = sender;
      setLive(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start.');
    }
  }

  return (
    <main>
      <h2>Go live</h2>
      <fieldset>
        <legend>Source</legend>
        <label><input type="radio" name="src" checked={source === 'screen'} onChange={() => setSource('screen')} /> Screen</label>
        <label><input type="radio" name="src" checked={source === 'camera'} onChange={() => setSource('camera')} /> Camera</label>
        <label><input type="radio" name="src" checked={source === 'file'} onChange={() => setSource('file')} /> File</label>
      </fieldset>
      {source === 'file' && <input type="file" accept="video/*,audio/*" aria-label="media file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
      <fieldset>
        <legend>Mode</legend>
        <label><input type="radio" name="mode" checked={mode === 'realtime'} onChange={() => setMode('realtime')} /> Real-time</label>
        <label><input type="radio" name="mode" checked={mode === 'quality'} onChange={() => setMode('quality')} /> High quality</label>
      </fieldset>
      {!live ? <button onClick={start}>Go live</button>
             : <p>● Live · {viewers} watching <button onClick={() => { senderRef.current?.close(); setLive(false); }}>Stop</button></p>}
      {error && <p role="alert">{error}</p>}
      <video ref={fileVideoRef} muted playsInline style={{ display: source === 'file' ? 'block' : 'none', width: '100%' }} />
    </main>
  );
}
