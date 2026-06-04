import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BroadcastViewer } from '../../core/broadcast-session';
import type { Transport } from '../../core/connection-machine';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

export default function Watch() {
  const { code = '' } = useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [transport, setTransport] = useState<Transport>('unknown');
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    let viewer: BroadcastViewer | null = null;
    (async () => {
      try {
        const api = new ApiClient(SERVER);
        const ice = await api.turnCredentials();
        viewer = new BroadcastViewer(WS, api.token ?? '', code, ice);
        viewer.onRemoteStream((s) => { if (videoRef.current) { videoRef.current.srcObject = s; setStatus('connected'); } });
        viewer.onTransport(setTransport);
        viewer.onEnded(() => setStatus('stream ended'));
        viewer.start();
      } catch {
        setStatus('could not connect');
      }
    })();
    return () => viewer?.close();
  }, [code]);

  return (
    <main>
      <h2>Watching</h2>
      <p>{status}{transport !== 'unknown' ? ` · ${transport}` : ''}</p>
      <video ref={videoRef} autoPlay playsInline controls style={{ width: '100%' }} />
    </main>
  );
}
