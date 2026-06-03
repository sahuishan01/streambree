import type { ClientMsg, Role, ServerMsg } from './protocol';

/** Subset of RTCPeerConnection we use — lets tests inject a fake. */
export interface IPeer {
  addTrack(track: MediaStreamTrack, stream: MediaStream): void;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null;
  ontrack: ((ev: { streams: MediaStream[] }) => void) | null;
}

export type PeerFactory = (iceServers: RTCIceServer[]) => IPeer;

const defaultFactory: PeerFactory = (iceServers) =>
  new RTCPeerConnection({ iceServers }) as unknown as IPeer;

export class RtcSession {
  private peer: IPeer | null = null;
  private remoteStreamHandler: ((s: MediaStream) => void) | null = null;

  constructor(
    private role: Role,
    private factory: PeerFactory = defaultFactory,
    private sendSignal: (msg: ClientMsg) => void = () => {},
  ) {}

  onRemoteStream(handler: (stream: MediaStream) => void) {
    this.remoteStreamHandler = handler;
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
    if (localStream) {
      for (const track of localStream.getTracks()) peer.addTrack(track, localStream);
    }
  }

  /** Called when the other peer is ready; the sender initiates the offer. */
  async onPeerReady() {
    if (this.role !== 'sender' || !this.peer) return;
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: offer.sdp ?? '' });
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
