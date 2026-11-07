import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { ConnStatus, ConnectionTrack, Notice, PageHead, TransportStatus } from '../components/ui';
import { VolumeIcon } from '../components/icons';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';
const RECENT_KEY = 'sl_recent_rooms';
const CODE_MIN = 4;
const CODE_MAX = 10;

function normalize(raw: string) { return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_MAX); }

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}

function addRecent(code: string) {
  try {
    const list = [code, ...getRecent().filter((c) => c !== code)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* storage unavailable — recent rooms are a convenience */ }
}

export default function Receiver() {
  const [params, setParams] = useSearchParams();
  const linkCode = normalize(params.get('code') ?? '');
  const [input, setInput] = useState(linkCode);
  const [room, setRoom] = useState<string | null>(linkCode.length >= CODE_MIN ? linkCode : null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [showUnmute, setShowUnmute] = useState(false);
  const [hasCam, setHasCam] = useState(false);
  const [recent, setRecent] = useState<string[]>(getRecent);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLVideoElement>(null);
  const { state, remote } = useSession(WS, 'receiver', 'realtime', room);

  useEffect(() => { if (room) { addRecent(room); setRecent(getRecent()); } }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!remote || !el) return;
    el.srcObject = remote;
    el.muted = true;

    const videos = remote.getVideoTracks();
    const multiCam = videos.length > 1;
    setHasCam(multiCam);
    if (multiCam && pipRef.current) {
      pipRef.current.srcObject = new MediaStream([videos[1]]);
      pipRef.current.play().catch(() => {});
    }

    el.oncanplay = () => {
      el.oncanplay = null;
      el.play().catch(() => {});
      setPlaying(true);
      setShowUnmute(true);
    };
  }, [remote]);

  useEffect(() => {
    if (room) return;
    const handlePaste = (e: ClipboardEvent) => {
      const code = normalize(e.clipboardData?.getData('text') ?? '');
      if (code.length >= CODE_MIN) { e.preventDefault(); join(code); }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [room]);

  function unmute() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    setShowUnmute(false);
  }

  function join(code?: string) {
    const val = normalize(code ?? input);
    if (val.length < CODE_MIN) { setError(`Room codes are at least ${CODE_MIN} characters.`); return; }
    setError('');
    setInput(val);
    setRoom(val);
    setPlaying(false);
    addRecent(val);
    setRecent(getRecent());
  }

  function leave() {
    if (videoRef.current) videoRef.current.srcObject = null;
    setRoom(null);
    setPlaying(false);
    setShowUnmute(false);
    setHasCam(false);
    if (params.has('code')) setParams({}, { replace: true });
  }

  if (!room) {
    return (
      <div className="page page-form">
        <PageHead title="Join a stream" desc="Enter the room code shown on the streaming device." />
        <form className="panel stack" onSubmit={(e) => { e.preventDefault(); join(); }}>
          <div className="field">
            <label className="label" htmlFor="room-code">Room code</label>
            <input id="room-code" className="input input-code" value={input} maxLength={CODE_MAX}
              autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
              placeholder="ABCDE FGHIJ" aria-invalid={error ? true : undefined}
              aria-describedby="room-code-hint"
              onChange={(e) => { setInput(normalize(e.target.value)); setError(''); }} />
            <p id="room-code-hint" className="hint">Tip: paste a code anywhere on this page to join right away.</p>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={input.length < CODE_MIN}>
            Join
          </button>
        </form>

        {recent.length > 0 && (
          <section className="stack-sm" style={{ marginTop: 'var(--sp-6)' }} aria-labelledby="recent-title">
            <h2 id="recent-title" className="eyebrow">Recent rooms</h2>
            <div className="cluster">
              {recent.map((c) => (
                <button key={c} type="button" className="btn btn-secondary btn-sm mono" onClick={() => join(c)}
                  aria-label={`Join room ${c}`}>
                  {c}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  const waiting = !playing && state.conn !== 'closed';

  return (
    <div className="page">
      <PageHead
        title={<span className="mono" style={{ letterSpacing: '0.08em' }}>{room}</span>}
        actions={<button type="button" className="btn btn-secondary" onClick={leave}>Leave</button>}>
        <div className="cluster">
          <ConnStatus conn={state.conn} />
          <TransportStatus transport={state.transport} />
        </div>
      </PageHead>

      <div className="stack">
        {waiting && <ConnectionTrack conn={state.conn} waitingLabel="Waiting for sender" />}
        <div className="stage">
          {waiting && (
            <div className="stage-overlay">
              <div className="spinner" aria-hidden="true" />
              <div className="stage-overlay-title">
                {state.conn === 'negotiating' ? 'Connecting…' : 'Waiting for the sender'}
              </div>
              <div className="small">Keep this page open. The stream starts as soon as the other device is ready.</div>
            </div>
          )}
          {state.conn === 'closed' && !playing && (
            <div className="stage-overlay">
              <div className="stage-overlay-title">Connection closed</div>
              <div className="small">Check the code and try again.</div>
            </div>
          )}
          {showUnmute && (
            <div className="stage-overlay">
              <button type="button" className="btn btn-primary btn-lg" onClick={unmute}>
                <VolumeIcon /> Turn on sound
              </button>
            </div>
          )}
          <video ref={videoRef} playsInline controls aria-label="Remote stream" />
          {hasCam && <video ref={pipRef} className="stage-pip" playsInline muted aria-label="Sender webcam" />}
        </div>
        {state.conn === 'reconnecting' && <Notice tone="warn">Connection dropped. Trying to reconnect…</Notice>}
      </div>
    </div>
  );
}
