import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Mode } from '../../core/protocol';
import type { ConnState, Transport } from '../../core/connection-machine';
import {
  ArrowLeftIcon, BoltIcon, CameraIcon, CopyIcon, FileIcon, FilmIcon, LinkIcon, ScreenIcon,
} from './icons';

/* ── Page header ─────────────────────────────────────────────── */
export function PageHead({ title, desc, actions, back, children }: {
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {back && (
          <Link to={back.to} className="back-link">
            <ArrowLeftIcon width={14} height={14} /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
        {children}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

/* ── Notices ─────────────────────────────────────────────────── */
type NoticeTone = 'info' | 'warn' | 'error' | 'success';
export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  const urgent = tone === 'error' || tone === 'warn';
  return <div className={`notice notice-${tone}`} role={urgent ? 'alert' : 'status'}>{children}</div>;
}

/* ── Empty state ─────────────────────────────────────────────── */
export function EmptyState({ icon, title, desc, action }: {
  icon?: ReactNode; title: string; desc?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action}
    </div>
  );
}

/* ── Connection status ───────────────────────────────────────── */
const CONN_LABEL: Record<ConnState, string> = {
  idle: 'Idle',
  joining: 'Opening room',
  'waiting-for-peer': 'Waiting',
  negotiating: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  closed: 'Closed',
};
const CONN_TONE: Partial<Record<ConnState, string>> = {
  connected: 'status-ok',
  reconnecting: 'status-warn',
  closed: 'status-bad',
};

export function ConnStatus({ conn }: { conn: ConnState }) {
  return <span className={`status ${CONN_TONE[conn] ?? ''}`}>{CONN_LABEL[conn]}</span>;
}

export function TransportStatus({ transport }: { transport: Transport }) {
  if (transport === 'unknown') return null;
  return (
    <span className="status status-plain" title={transport === 'relay'
      ? 'Media is relayed through the TURN server because a direct path was blocked.'
      : 'Media flows directly between the two devices.'}>
      {transport === 'direct' ? 'Direct P2P' : 'Relayed'}
    </span>
  );
}

/** Three-step progress track: waiting → connecting → connected. */
export function ConnectionTrack({ conn, waitingLabel }: { conn: ConnState; waitingLabel: string }) {
  const step = conn === 'connected' ? 2 : conn === 'negotiating' || conn === 'reconnecting' ? 1 : 0;
  const labels = [waitingLabel, conn === 'reconnecting' ? 'Reconnecting' : 'Connecting', 'Connected'];
  return (
    <ol className="track" aria-label="Connection progress">
      {labels.map((label, i) => (
        <li key={label} className={i < step ? 'is-done' : i === step ? 'is-current' : ''}
          aria-current={i === step ? 'step' : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

/* ── Room code ticket ────────────────────────────────────────── */
function chunk(code: string, size = 5): string[] {
  const parts: string[] = [];
  for (let i = 0; i < code.length; i += size) parts.push(code.slice(i, i + size));
  return parts;
}

export function RoomTicket({ code, onCopy, children }: {
  code: string;
  onCopy: (text: string, what: 'code' | 'link') => void;
  children?: ReactNode;
}) {
  const joinLink = `${location.origin}/join?code=${code}`;
  return (
    <section className="ticket" aria-label="Room code">
      <div className="spread">
        <span className="eyebrow">Room code</span>
        {children}
      </div>
      <div className="ticket-code" aria-label={`Room code ${code.split('').join(' ')}`}>
        {chunk(code).map((part, i) => <span key={i}>{part}</span>)}
      </div>
      <div className="ticket-actions">
        <button type="button" className="btn btn-primary" onClick={() => onCopy(code, 'code')}>
          <CopyIcon /> Copy code
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onCopy(joinLink, 'link')}>
          <LinkIcon /> Copy join link
        </button>
      </div>
    </section>
  );
}

/* ── Stream setup controls ───────────────────────────────────── */
export type SourceKind = 'screen' | 'camera' | 'file';

export const MEDIA_ACCEPT =
  'video/*,audio/*,.mkv,.mp4,.webm,.avi,.mov,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.aiff';

const SOURCES: { kind: SourceKind; title: string; desc: string; icon: ReactNode }[] = [
  { kind: 'screen', title: 'Screen', desc: 'A window, tab or whole display', icon: <ScreenIcon /> },
  { kind: 'camera', title: 'Camera', desc: 'Your webcam and microphone', icon: <CameraIcon /> },
  { kind: 'file', title: 'File', desc: 'A local video or audio file', icon: <FileIcon /> },
];

export function SourcePicker({ source, onChange, canShareScreen }: {
  source: SourceKind; onChange: (s: SourceKind) => void; canShareScreen: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="choices">
      <legend className="visually-hidden">Source</legend>
      {SOURCES.map((s) => {
        const disabled = s.kind === 'screen' && !canShareScreen;
        const checked = source === s.kind;
        return (
          <label key={s.kind}
            className={`choice${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}`}>
            <input type="radio" name={name} checked={checked} disabled={disabled}
              onChange={() => onChange(s.kind)} />
            <span className="choice-title">{s.icon}{s.title}</span>
            <span className="choice-desc">{disabled ? 'Not supported in this browser' : s.desc}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function ModePicker({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const name = useId();
  const options: { value: Mode; title: string; desc: string; icon: ReactNode }[] = [
    { value: 'realtime', title: 'Real-time', desc: 'Lowest delay. Best for desktops, games and calls.', icon: <BoltIcon /> },
    { value: 'quality', title: 'High quality', desc: 'Sharper picture with a short buffer. Best for movies.', icon: <FilmIcon /> },
  ];
  return (
    <fieldset className="choices choices-2">
      <legend className="visually-hidden">Quality mode</legend>
      {options.map((o) => (
        <label key={o.value} className={`choice${mode === o.value ? ' is-checked' : ''}`}>
          <input type="radio" name={name} checked={mode === o.value} onChange={() => onChange(o.value)} />
          <span className="choice-title">{o.icon}{o.title}</span>
          <span className="choice-desc">{o.desc}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function StepSection({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="step-section" aria-labelledby={id}>
      <h2 className="step-heading" id={id}><span className="step-num" aria-hidden="true">{n}</span>{title}</h2>
      <div className="step-body">{children}</div>
    </section>
  );
}

/* ── Elapsed timer ───────────────────────────────────────────── */
export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Seconds since `running` became true; resets to 0 when it turns false. */
export function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) { setSeconds(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}

/* ── Modal dialog ────────────────────────────────────────────── */
export function Modal({ title, desc, onClose, children }: {
  title: string; desc?: ReactNode; onClose?: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Captured during the first render, before any autoFocus inside the dialog moves focus.
  const previousRef = useRef(document.activeElement as HTMLElement | null);

  useEffect(() => {
    const previous = previousRef.current;
    const box = ref.current;
    const focusables = () => Array.from(box?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    if (!box?.contains(document.activeElement)) focusables()[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && onCloseRef.current) { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 className="modal-title" id={titleId}>{title}</h2>
          {desc && <p className="muted small">{desc}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
