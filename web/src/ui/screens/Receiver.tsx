import { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../../api/rest';
import { useSession } from '../hooks/useSession';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';

export default function Receiver() {
  const [input, setInput] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state, remote } = useSession(WS, 'receiver', 'realtime', room);

  useEffect(() => {
    if (remote && videoRef.current) videoRef.current.srcObject = remote;
  }, [remote]);

  async function join() {
    const api = new ApiClient(SERVER);
    const ok = input.length === 6 ? true : await api.resolveRoom(input);
    if (!ok) { setError('No such room.'); return; }
    setError('');
    setRoom(input);
  }

  return (
    <main>
      <h2>Join a stream</h2>
      <input aria-label="code" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Enter code" />
      <button onClick={join}>Join</button>
      {error && <p role="alert">{error}</p>}
      <p>{state.conn}{state.transport !== 'unknown' ? ` · ${state.transport}` : ''}</p>
      <video ref={videoRef} autoPlay playsInline controls style={{ width: '100%' }} />
    </main>
  );
}
