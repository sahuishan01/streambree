import { useEffect, useRef, useState } from 'react';
import { useSession } from '../hooks/useSession';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';

export default function Receiver() {
  const [input, setInput] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsPlay, setNeedsPlay] = useState(false);
  const { state, remote } = useSession(WS, 'receiver', 'realtime', room);

  useEffect(() => {
    if (remote && videoRef.current) {
      videoRef.current.srcObject = remote;
      videoRef.current.play().catch(() => setNeedsPlay(true));
    }
  }, [remote]);

  function join() {
    if (input.trim().length < 4) { setError('Enter a valid code.'); return; }
    setError('');
    setRoom(input.trim());
  }

  return (
    <main>
      <h2>Join a stream</h2>
      <input aria-label="code" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Enter code" />
      <button onClick={join}>Join</button>
      {error && <p role="alert">{error}</p>}
      <p>{state.conn}{state.transport !== 'unknown' ? ` · ${state.transport}` : ''}</p>
      {needsPlay && (
        <button onClick={() => { videoRef.current?.play(); setNeedsPlay(false); }}>
          ▶ Click to play with audio
        </button>
      )}
      <video ref={videoRef} playsInline controls style={{ width: '100%' }} />
    </main>
  );
}
