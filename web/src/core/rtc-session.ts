import type { ClientMsg, Mode, Role, ServerMsg } from './protocol';
import type { Transport } from './connection-machine';
import { enhanceAudioSdp } from './sdp-utils';
import { applyMode } from './modes';
import { detectTransport } from './transport';

/** Subset of RTCPeerConnection we use — lets tests inject a fake. */
export interface IPeer {
  addTrack(track: MediaStreamTrack, stream: MediaStream): void;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  getSenders(): RTCRtpSender[];
  getReceivers(): RTCRtpReceiver[];
  getStats(): Promise<RTCStatsReport>;
  close(): void;
  connectionState: RTCPeerConnectionState;
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null;
  ontrack: ((ev: { streams: MediaStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
}

export type PeerFactory = (iceServers: RTCIceServer[]) => IPeer;

const defaultFactory: PeerFactory = (iceServers) =>
  new RTCPeerConnection({ iceServers }) as unknown as IPeer;

export class RtcSession {
  private peer: IPeer | null = null;
  private remoteStreamHandler: ((s: MediaStream) => void) | null = null;
  private connectedHandler: ((transport: Transport) => void) | null = null;
  private connectedFired = false;

  constructor(
    private role: Role,
    private factory: PeerFactory = defaultFactory,
    private sendSignal: (msg: ClientMsg) => void = () => {},
    private mode: Mode = 'realtime',
  ) {}

  onRemoteStream(handler: (stream: MediaStream) => void) {
    this.remoteStreamHandler = handler;
  }

  /** Fires once when the connection is established, with the detected transport. */
  onConnected(handler: (transport: Transport) => void) {
    this.connectedHandler = handler;
  }

  async start(iceServers: RTCIceServer[], localStream?: MediaStream) {
    const peer = this.factory(iceServers);
    this.peer = peer;
    peer.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal({ type: 'ice', candidate: ev.candidate });
    };
    peer.ontrack = (ev) => {
      if (ev.streams[0]) this.remoteStreamHandler?.(ev.streams[0]);
    };
    peer.onconnectionstatechange = () => {
      void this.handleConnectionState();
    };
    if (localStream) {
      for (const track of localStream.getTracks()) peer.addTrack(track, localStream);
    }
  }

  /** On first 'connected', apply the mode's params and report the transport. */
  private async handleConnectionState() {
    if (!this.peer || this.connectedFired) return;
    if (this.peer.connectionState !== 'connected') return;
    this.connectedFired = true;
    await applyMode(this.peer, this.mode);
    const transport = await detectTransport(this.peer);
    this.connectedHandler?.(transport);
  }

  /** Called when the other peer is ready; the sender initiates the offer. */
  async onPeerReady() {
    if (this.role !== 'sender' || !this.peer) return;
    const offer = await this.peer.createOffer();
    const enhancedSdp = enhanceAudioSdp(offer.sdp ?? '');
    await this.peer.setLocalDescription({ type: 'offer', sdp: enhancedSdp });
    this.sendSignal({ type: 'offer', sdp: enhancedSdp });
  }

  async handleSignal(msg: ServerMsg) {
    if (!this.peer) return;
    if (msg.type === 'offer') {
      await this.peer.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      this.sendSignal({ type: 'answer', sdp: answer.sdp ?? '' });
    } else if (msg.type === 'answer') {
      await this.peer.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === 'ice') {
      await this.peer.addIceCandidate(msg.candidate);
    }
  }

  close() {
    this.peer?.close();
    this.peer = null;
  }
}
