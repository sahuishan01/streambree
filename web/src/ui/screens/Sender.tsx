import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera, captureFile, isAudioFile, keepFileAlive, requestWakeLock, releaseWakeLock, mergeStreams } from '../../core/sources';
import { useSession } from '../hooks/useSession';
import { useToast } from '../toast';
import {
  ConnStatus, ConnectionTrack, MEDIA_ACCEPT, ModePicker, Notice, PageHead, RoomTicket,
  SourcePicker, StepSection, TransportStatus, type SourceKind,
} from '../components/ui';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';
const canShareScreen = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join('');
}

function stopTracks(s?: MediaStream) { s?.getTracks().forEach((t) => t.stop()); }

export default function Sender() {
  const nav = useNavigate();
  useEffect(() => { if (!localStorage.getItem('sl_token')) nav('/auth'); }, []);
  const [source, setSource] = useState<SourceKind>(canShareScreen ? 'screen' : 'file');
  const [mode, setMode] = useState<Mode>('realtime');
  const [room, setRoom] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [noAudio, setNoAudio] = useState(false);
  const [starting, setStarting] = useState(false);
  const [camStream, setCamStream] = useState<MediaStream | undefined>();
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const fileAudioRef = useRef<HTMLAudioElement>(null);
  const camPreviewRef = useRef<HTMLVideoElement>(null);
  const keepAliveRef = useRef<(() => void) | null>(null);
  const streamsRef = useRef<{ main?: MediaStream; cam?: MediaStream }>({});
  const { state } = useSession(WS, 'sender', mode, room, stream);
  const { toast } = useToast();

  streamsRef.current = { main: stream, cam: camStream };
  // Stop capture when leaving the page so the browser's "sharing" indicator goes away.
  useEffect(() => () => {
    stopTracks(streamsRef.current.main);
    stopTracks(streamsRef.current.cam);
    releaseWakeLock();
    keepAliveRef.current?.();
  }, []);

  useEffect(() => {
    if (!room) {
      releaseWakeLock();
      keepAliveRef.current?.();
      keepAliveRef.current = null;
    }
  }, [room]);

  useEffect(() => {
    if (camStream && camPreviewRef.current) {
      camPreviewRef.current.srcObject = camStream;
      camPreviewRef.current.play().catch(() => {});
    }
  }, [camStream, room]);

  const audioOnly = file ? isAudioFile(file) : false;
  const isLive = room !== null;
  const needsFile = source === 'file' && !file;
  const showFilePlayer = isLive && source === 'file' && !!file;

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

  async function createSession() {
    setError('');
    setStarting(true);
    try {
      let captured = await capture();
      if (camStream) captured = mergeStreams(captured, camStream);
      setNoAudio(!captured.getAudioTracks().length);
      setStream(captured);
      setRoom(makeCode());
      void requestWakeLock();
      if (source === 'file') {
        const el = audioOnly ? fileAudioRef.current : fileVideoRef.current;
        if (el) keepAliveRef.current = keepFileAlive(el);
      }
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'NotAllowedError';
      setError(cancelled ? 'Capture was cancelled or blocked by the browser.'
        : e instanceof Error ? e.message : 'Could not start capture.');
    } finally {
      setStarting(false);
    }
  }

  function stopSession() {
    stopTracks(stream);
    stopTracks(camStream);
    fileVideoRef.current?.pause();
    fileAudioRef.current?.pause();
    setStream(undefined);
    setCamStream(undefined);
    setRoom(null);
    setNoAudio(false);
  }

  async function copy(text: string, what: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', what === 'code' ? 'Room code copied' : 'Join link copied');
    } catch {
      toast('error', 'Could not copy. Select the code and copy it manually.');
    }
  }

  return (
    <div className="page page-form">
      <PageHead
        title={isLive ? 'You are streaming' : 'Start streaming'}
        desc={isLive
          ? 'Enter this code on the other device, or send it the join link.'
          : 'Share to one other device. You will get a room code to enter there.'}
      />

      {!isLive ? (
        <div className="stack-lg">
          <StepSection n={1} title="Choose what to share">
            <SourcePicker source={source} onChange={setSource} canShareScreen={canShareScreen} />
            {source === 'screen' && (
              <p className="hint">To include sound, tick “Share audio” in the browser’s picker.</p>
            )}
            {source === 'file' && (
              <div className="field">
                <label className="label" htmlFor="send-file">Media file</label>
                <input id="send-file" className="input input-file" type="file" accept={MEDIA_ACCEPT}
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
            <button type="button" className="btn btn-primary btn-lg btn-block"
              onClick={createSession} disabled={starting || needsFile}>
              {starting ? 'Starting…' : 'Create room'}
            </button>
            {needsFile && <p className="hint" style={{ textAlign: 'center' }}>Choose a file to continue.</p>}
          </div>
        </div>
      ) : (
        <div className="stack">
          <RoomTicket code={room} onCopy={copy}>
            <div className="cluster">
              <ConnStatus conn={state.conn} />
              <TransportStatus transport={state.transport} />
            </div>
          </RoomTicket>
          <ConnectionTrack conn={state.conn} waitingLabel="Waiting for viewer" />
          {noAudio && (
            <Notice tone="warn">
              No audio track, so the viewer will hear nothing. For screen sharing, restart and tick
              “Share audio”. For files, AC3/DTS audio is not supported; convert it to AAC.
            </Notice>
          )}
          {camStream && <video ref={camPreviewRef} className="cam-preview" playsInline muted aria-label="Webcam preview" />}
        </div>
      )}

      {/* File players stay mounted so captureStream() keeps running; parked off-screen when unused. */}
      <div className="stack" style={{ marginTop: showFilePlayer ? 'var(--sp-5)' : 0 }}>
        <audio ref={fileAudioRef} controls={isLive && showFilePlayer && audioOnly}
          className={showFilePlayer && audioOnly ? 'file-player-audio' : 'offscreen-media'} />
        <video ref={fileVideoRef} playsInline controls={isLive && showFilePlayer && !audioOnly}
          className={showFilePlayer && !audioOnly ? 'file-player' : 'offscreen-media'} />
      </div>

      {isLive && (
        <div style={{ marginTop: 'var(--sp-6)' }}>
          <button type="button" className="btn btn-danger btn-block" onClick={stopSession}>Stop streaming</button>
        </div>
      )}
    </div>
  );
}
