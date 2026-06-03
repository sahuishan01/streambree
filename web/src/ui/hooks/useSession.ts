import { useEffect, useRef, useState } from 'react';
import { SignalingClient, type SocketFactory } from '../../core/signaling-client';
import { RtcSession, type PeerFactory } from '../../core/rtc-session';
import { initial, reduce, type MachineState } from '../../core/connection-machine';
import type { Mode, Role, ServerMsg } from '../../core/protocol';

/** Framework-agnostic orchestrator (also unit-testable without React). */
export class Session {
  private signaling: SignalingClient;
  private rtc: RtcSession;
  private state: MachineState = initial;
  private stateHandler: ((s: MachineState) => void) | null = null;
  private remoteHandler: ((s: MediaStream) => void) | null = null;
  private iceServers: RTCIceServer[] = [];

  constructor(
    url: string,
    private role: Role,
    private mode: Mode,
    socketFactory?: SocketFactory,
    peerFactory?: PeerFactory,
    private localStream?: MediaStream,
  ) {
    this.signaling = new SignalingClient(url, socketFactory);
    this.rtc = new RtcSession(role, peerFactory, (m) => this.signaling.send(m), mode);
    this.signaling.onMessage((m) => this.onServer(m));
    this.rtc.onRemoteStream((s) => this.remoteHandler?.(s));
    this.rtc.onConnected((transport) => this.dispatch({ type: 'connected', transport }));
  }

  onState(h: (s: MachineState) => void) { this.stateHandler = h; }
  onRemoteStream(h: (s: MediaStream) => void) { this.remoteHandler = h; }

  start(room: string) {
    this.dispatch({ type: 'join' });
    this.signaling.join(room, this.role, this.mode);
  }

  private dispatch(ev: Parameters<typeof reduce>[1]) {
    this.state = reduce(this.state, ev);
    this.stateHandler?.(this.state);
  }

  private async onServer(msg: ServerMsg) {
    switch (msg.type) {
      case 'joined':
        this.iceServers = msg.ice_servers;
        await this.rtc.start(this.iceServers, this.localStream);
        this.dispatch({ type: 'joined', peerPresent: msg.peer_present });
        if (msg.peer_present) await this.rtc.onPeerReady();
        break;
      case 'peer-joined':
        this.dispatch({ type: 'peer-joined' });
        await this.rtc.onPeerReady();
        break;
      case 'offer':
      case 'answer':
      case 'ice':
        // The machine advances to 'connected' from RtcSession.onConnected
        // (real ICE connectivity), not from receiving an answer.
        await this.rtc.handleSignal(msg);
        break;
      case 'peer-left':
        this.dispatch({ type: 'peer-left' });
        break;
      case 'error':
        this.dispatch({ type: 'close' });
        break;
    }
  }

  close() {
    this.dispatch({ type: 'close' });
    this.signaling.close();
    this.rtc.close();
  }
}

/** React binding around Session. */
export function useSession(
  url: string,
  role: Role,
  mode: Mode,
  room: string | null,
  localStream?: MediaStream,
) {
  const [state, setState] = useState<MachineState>(initial);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const ref = useRef<Session | null>(null);

  useEffect(() => {
    if (!room) return;
    const session = new Session(url, role, mode, undefined, undefined, localStream);
    ref.current = session;
    session.onState(setState);
    session.onRemoteStream(setRemote);
    session.start(room);
    return () => session.close();
  }, [url, role, mode, room, localStream]);

  return { state, remote };
}
