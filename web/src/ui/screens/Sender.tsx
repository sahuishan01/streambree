import { useRef, useState } from 'react';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera, captureFile } from '../../core/sources';
import { ApiClient } from '../../api/rest';
import { useSession } from '../hooks/useSession';

type SourceKind = 'screen' | 'camera' | 'file';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';

export default function Sender() {
  const [source, setSource] = useState<SourceKind>('screen');
  const [mode, setMode] = useState<Mode>('realtime');
  const [room, setRoom] = useState<string | null>(null);
  const [code, setCode] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
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

  async function createSession() {
    try {
      const captured = await capture();
      setStream(captured);
      const api = new ApiClient(SERVER);
      const res = await api.createGuestRoom();
      setCode(res.code);
      setRoom(res.code);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start capture (permission denied?).');
    }
  }

  return (
    <main>
      <h2>Start streaming</h2>
      <fieldset>
        <legend>Source</legend>
        <label><input type="radio" name="src" checked={source === 'screen'} onChange={() => setSource('screen')} /> Screen</label>
        <label><input type="radio" name="src" checked={source === 'camera'} onChange={() => setSource('camera')} /> Camera</label>
        <label><input type="radio" name="src" checked={source === 'file'} onChange={() => setSource('file')} /> File</label>
      </fieldset>
      {source === 'file' && (
        <input type="file" accept="video/*,audio/*" aria-label="media file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      )}
      <fieldset>
        <legend>Mode</legend>
        <label><input type="radio" name="mode" checked={mode === 'realtime'} onChange={() => setMode('realtime')} /> Real-time</label>
        <label><input type="radio" name="mode" checked={mode === 'quality'} onChange={() => setMode('quality')} /> High quality</label>
      </fieldset>
      <button onClick={createSession}>Create session</button>
      {error && <p role="alert">{error}</p>}
      {code && <p>Room code: <strong>{code}</strong> · {state.conn}{state.transport !== 'unknown' ? ` · ${state.transport}` : ''}</p>}
      <video ref={fileVideoRef} muted playsInline style={{ display: source === 'file' ? 'block' : 'none', width: '100%' }} />
    </main>
  );
}
