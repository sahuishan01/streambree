import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera, captureFile, isAudioFile, keepFileAlive, requestWakeLock, releaseWakeLock, mergeStreams } from '../../core/sources';
import { BroadcastSender } from '../../core/broadcast-session';
import { ApiClient } from '../../api/rest';
import { useToast } from '../toast';
import {
  MEDIA_ACCEPT, ModePicker, Notice, PageHead, SourcePicker, StepSection, formatElapsed, useElapsed,
  type SourceKind,
} from '../components/ui';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';
const canShareScreen = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

function stopTracks(s?: MediaStream) { s?.getTracks().forEach((t) => t.stop()); }

export default function GoLive() {
  const nav = useNavigate();
  useEffect(() => { if (!localStorage.getItem('sl_token')) nav('/auth'); }, []);
  const { code = '' } = useParams();
  const [source, setSource] = useState<SourceKind>(canShareScreen ? 'screen' : 'file');
  const [mode, setMode] = useState<Mode>('realtime');
  const [file, setFile] = useState<File | null>(null);
  const [viewers, setViewers] = useState(0);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [noAudio, setNoAudio] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | undefined>();
  const camPreviewRef = useRef<HTMLVideoElement>(null);
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const fileAudioRef = useRef<HTMLAudioElement>(null);
  const senderRef = useRef<BroadcastSender | null>(null);
  const streamRef = useRef<MediaStream | undefined>();
  const camRef = useRef<MediaStream | undefined>();
  const keepAliveRef = useRef<(() => void) | null>(null);
  const api = new ApiClient(SERVER);
  const { toast } = useToast();
  const elapsed = useElapsed(live);

  camRef.current = camStream;
  // Leaving the page ends the broadcast and releases capture devices.
  useEffect(() => () => {
    senderRef.current?.close();
    stopTracks(streamRef.current);
    stopTracks(camRef.current);
    releaseWakeLock();
    keepAliveRef.current?.();
  }, []);

  useEffect(() => {
    if (camStream && camPreviewRef.current) {
      camPreviewRef.current.srcObject = camStream;
      camPreviewRef.current.play().catch(() => {});
    }
  }, [camStream, live]);

  const audioOnly = file ? isAudioFile(file) : false;
  const needsFile = source === 'file' && !file;
  const showFilePlayer = live && source === 'file' && !!file;

  async function capture(): Promise<MediaStream> {
    if (source === 'camera') return captureCamera();
    if (source === 'file') {
      if (!file) throw new Error('Choose a file first.');
      const el = audioOnly ? fileAudioRef.current : fileVideoRef.current;
      if (!el) throw new Error('The file player is not ready yet. Try again.');
      return captureFile(file, el);
    }
    return captureScreen();
  }

  async function toggleCam() {
    if (camStream) {
      stopTracks(camStream);
      setCamStream(undefined);
      return;
    }
    try {
      setCamStream(await captureCamera(true));
    } catch {
      toast('error', 'Could not access the camera. Check browser permissions.');
    }
  }

  async function start() {
    setError('');
    setStarting(true);
    try {
      let stream = await capture();
      if (camStream) stream = mergeStreams(stream, camStream);
      streamRef.current = stream;
      const hasAudio = stream.getAudioTracks().length > 0;
      setNoAudio(!hasAudio);
      const ice = await api.turnCredentials();
      const sender = new BroadcastSender(WS, api.token ?? '', code, mode, stream, ice);
      sender.onViewerCount(setViewers);
      sender.onStopped(() => { stop(); setError('The stream was stopped by a channel moderator.'); });
      sender.start();
      senderRef.current = sender;
      setLive(true);
      void requestWakeLock();
      if (source === 'file') {
        const el = audioOnly ? fileAudioRef.current : fileVideoRef.current;
        if (el) keepAliveRef.current = keepFileAlive(el);
      }
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'NotAllowedError';
      setError(cancelled ? 'Capture was cancelled or blocked by the browser.'
        : e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  function stop() {
    senderRef.current?.close();
    senderRef.current = null;
    setLive(false);
    setViewers(0);
    releaseWakeLock();
    keepAliveRef.current?.();
    keepAliveRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = undefined;
    stopTracks(camRef.current);
    setCamStream(undefined);
    fileVideoRef.current?.pause();
    fileAudioRef.current?.pause();
  }

  return (
    <div className="page page-form">
      <PageHead
        back={{ to: '/channels', label: 'Channels' }}
        title={live ? 'You are live' : 'Go live'}
        desc={live ? 'Everyone in the channel can watch now.' : 'Broadcast to everyone in this channel.'}
      />

      {!live ? (
        <div className="stack-lg">
          <StepSection n={1} title="Choose what to share">
            <SourcePicker source={source} onChange={setSource} canShareScreen={canShareScreen} />
            {source === 'screen' && (
              <p className="hint">To include sound, tick “Share audio” in the browser’s picker.</p>
            )}
            {source === 'file' && (
              <div className="field">
                <label className="label" htmlFor="live-file">Media file</label>
                <input id="live-file" className="input input-file" type="file" accept={MEDIA_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            )}
            {(source === 'screen' || source === 'file') && (
              <label className="check">
                <input type="checkbox" checked={!!camStream} onChange={toggleCam} />
                Add webcam overlay (picture-in-picture)
              </label>
            )}
            {camStream && <video ref={camPreviewRef} className="cam-preview" playsInline muted aria-label="Webcam preview" />}
          </StepSection>

          <StepSection n={2} title="Pick a quality mode">
            <ModePicker mode={mode} onChange={setMode} />
          </StepSection>

          {error && <Notice tone="error">{error}</Notice>}

          <div className="stack-sm">
            <button type="button" className="btn btn-live btn-lg btn-block" onClick={start} disabled={starting || needsFile}>
              {starting ? 'Starting…' : 'Go live'}
            </button>
            {needsFile && <p className="hint" style={{ textAlign: 'center' }}>Choose a file to continue.</p>}
          </div>
        </div>
      ) : (
        <div className="stack">
          <section className="panel stack" aria-label="Broadcast status" style={{ alignItems: 'center', paddingBlock: 'var(--sp-6)' }}>
            <span className="status status-live">Broadcasting</span>
            <div className="stats">
              <div className="stat">
                <div className="stat-value" aria-live="polite">{viewers}</div>
                <div className="stat-label">{viewers === 1 ? 'viewer' : 'viewers'}</div>
              </div>
              <div className="stat">
                <div className="stat-value">{formatElapsed(elapsed)}</div>
                <div className="stat-label">elapsed</div>
              </div>
            </div>
            {viewers === 0 && <p className="muted small">Waiting for viewers to join…</p>}
          </section>
          {noAudio && (
            <Notice tone="warn">
              No audio track, so viewers hear nothing. For screen sharing, stop and restart with
              “Share audio” ticked. For files, AC3/DTS audio is not supported; convert it to AAC.
            </Notice>
          )}
          {camStream && <video ref={camPreviewRef} className="cam-preview" playsInline muted aria-label="Webcam preview" />}
        </div>
      )}

      {/* File players stay mounted so captureStream() keeps running; parked off-screen when unused. */}
      <div className="stack" style={{ marginTop: showFilePlayer ? 'var(--sp-5)' : 0 }}>
        <audio ref={fileAudioRef} controls={showFilePlayer && audioOnly}
          className={showFilePlayer && audioOnly ? 'file-player-audio' : 'offscreen-media'} />
        <video ref={fileVideoRef} playsInline controls={showFilePlayer && !audioOnly}
          className={showFilePlayer && !audioOnly ? 'file-player' : 'offscreen-media'} />
      </div>

      {live && (
        <div style={{ marginTop: 'var(--sp-6)' }}>
          <button type="button" className="btn btn-danger btn-block" onClick={stop}>End broadcast</button>
        </div>
      )}
    </div>
  );
}
