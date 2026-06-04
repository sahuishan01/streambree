import type { ISocket, SocketFactory } from './signaling-client';
import type { IPeer, PeerFactory } from './rtc-session';
import {
  type BroadcastServerMsg,
  parseBroadcastServerMsg,
  serializeBroadcastMsg,
} from './broadcast-protocol';
import { detectTransport } from './transport';
import type { Transport } from './connection-machine';
import type { Mode } from './protocol';
import { applyMode } from './modes';

const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as ISocket;
const defaultPeerFactory: PeerFactory = (iceServers) =>
  new RTCPeerConnection({ iceServers }) as unknown as IPeer;

/** A single viewer connection to the broadcaster. */
export class BroadcastViewer {
  private socket: ISocket | null = null;
  private peer: IPeer | null = null;
  private remoteHandler: ((s: MediaStream) => void) | null = null;
  private endedHandler: (() => void) | null = null;
  private transportHandler: ((t: Transport) => void) | null = null;

  constructor(
    private url: string,
    private jwt: string,
    private code: string,
    private iceServers: RTCIceServer[],
    private socketFactory: SocketFactory = defaultSocketFactory,
    private peerFactory: PeerFactory = defaultPeerFactory,
  ) {}

  onRemoteStream(h: (s: MediaStream) => void) { this.remoteHandler = h; }
  onEnded(h: () => void) { this.endedHandler = h; }
  onTransport(h: (t: Transport) => void) { this.transportHandler = h; }

  start() {
    const socket = this.socketFactory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(serializeBroadcastMsg({ type: 'join-broadcast', code: this.code, role: 'viewer', jwt: this.jwt }));
    };
    socket.onmessage = (ev) => {
      const msg = parseBroadcastServerMsg(ev.data);
      if (msg) void this.onServer(msg);
    };
  }

  private ensurePeer(): IPeer {
    if (this.peer) return this.peer;
    const peer = this.peerFactory(this.iceServers);
    this.peer = peer;
    peer.onicecandidate = (e) => {
      if (e.candidate) this.socket?.send(serializeBroadcastMsg({ type: 'ice', peer_id: '', candidate: e.candidate }));
    };
    peer.ontrack = (e) => { if (e.streams[0]) this.remoteHandler?.(e.streams[0]); };
    peer.onconnectionstatechange = () => { void this.onConn(); };
    return peer;
  }

  private async onConn() {
    if (this.peer && this.peer.connectionState === 'connected') {
      this.transportHandler?.(await detectTransport(this.peer));
    }
  }

  private async onServer(msg: BroadcastServerMsg) {
    switch (msg.type) {
      case 'offer': {
        const peer = this.ensurePeer();
        await peer.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.socket?.send(serializeBroadcastMsg({ type: 'answer', peer_id: '', sdp: answer.sdp ?? '' }));
        break;
      }
      case 'ice':
        await this.ensurePeer().addIceCandidate(msg.candidate);
        break;
      case 'broadcaster-left':
      case 'force-stopped':
        this.endedHandler?.();
        this.close();
        break;
      default:
        break;
    }
  }

  close() {
    this.peer?.close();
    this.peer = null;
    this.socket?.close();
    this.socket = null;
  }
}

interface ViewerConn {
  peer: IPeer;
}

/** The broadcaster: one peer connection per viewer, media stays P2P (sender-side fan-out). */
export class BroadcastSender {
  private socket: ISocket | null = null;
  private viewers = new Map<string, ViewerConn>();
  private countHandler: ((n: number) => void) | null = null;
  private stoppedHandler: (() => void) | null = null;

  constructor(
    private url: string,
    private jwt: string,
    private code: string,
    private mode: Mode,
    private localStream: MediaStream,
    private iceServers: RTCIceServer[],
    private socketFactory: SocketFactory = defaultSocketFactory,
    private peerFactory: PeerFactory = defaultPeerFactory,
  ) {}

  onViewerCount(h: (n: number) => void) { this.countHandler = h; }
  onStopped(h: () => void) { this.stoppedHandler = h; }

  start() {
    const socket = this.socketFactory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(serializeBroadcastMsg({ type: 'join-broadcast', code: this.code, role: 'broadcaster', jwt: this.jwt }));
    };
    socket.onmessage = (ev) => {
      const msg = parseBroadcastServerMsg(ev.data);
      if (msg) void this.onServer(msg);
    };
  }

  private async addViewer(peerId: string) {
    const peer = this.peerFactory(this.iceServers);
    peer.onicecandidate = (e) => {
      if (e.candidate) this.socket?.send(serializeBroadcastMsg({ type: 'ice', peer_id: peerId, candidate: e.candidate }));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') void applyMode(peer, this.mode);
    };
    for (const track of this.localStream.getTracks()) peer.addTrack(track, this.localStream);
    this.viewers.set(peerId, { peer });
    this.countHandler?.(this.viewers.size);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.socket?.send(serializeBroadcastMsg({ type: 'offer', peer_id: peerId, sdp: offer.sdp ?? '' }));
  }

  private removeViewer(peerId: string) {
    const v = this.viewers.get(peerId);
    if (v) {
      v.peer.close();
      this.viewers.delete(peerId);
      this.countHandler?.(this.viewers.size);
    }
  }

  private async onServer(msg: BroadcastServerMsg) {
    switch (msg.type) {
      case 'viewer-joined':
        await this.addViewer(msg.peer_id);
        break;
      case 'viewer-left':
        this.removeViewer(msg.peer_id);
        break;
      case 'answer': {
        const v = this.viewers.get(msg.peer_id);
        if (v) await v.peer.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        break;
      }
      case 'ice': {
        const v = this.viewers.get(msg.peer_id);
        if (v) await v.peer.addIceCandidate(msg.candidate);
        break;
      }
      case 'force-stopped':
        this.stoppedHandler?.();
        this.close();
        break;
      default:
        break;
    }
  }

  close() {
    for (const v of this.viewers.values()) v.peer.close();
    this.viewers.clear();
    this.socket?.close();
    this.socket = null;
  }
}
