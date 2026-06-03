import { describe, it, expect, vi } from 'vitest';
import { RtcSession, type IPeer } from '../rtc-session';
import type { ClientMsg } from '../protocol';

interface FakePeer extends IPeer {
  trigger: (h: string, arg?: unknown) => void;
  connectionState: RTCPeerConnectionState;
  stats: RTCStatsReport;
}

function fakePeer(): FakePeer {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER' }) as RTCSessionDescriptionInit),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'ANSWER' }) as RTCSessionDescriptionInit),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    getSenders: () => [],
    getReceivers: () => [],
    getStats: async function (this: FakePeer) { return this.stats; },
    stats: new Map() as unknown as RTCStatsReport,
    connectionState: 'new',
    close: vi.fn(),
    set onicecandidate(h: (arg?: unknown) => void) { handlers.ice = h; },
    set ontrack(h: (arg?: unknown) => void) { handlers.track = h; },
    set onconnectionstatechange(h: (arg?: unknown) => void) { handlers.conn = h; },
    trigger: (h, arg) => handlers[h]?.(arg),
  };
}

describe('RtcSession', () => {
  it('sender creates and emits an offer when negotiation starts', async () => {
    const peer = fakePeer();
    const sent: ClientMsg[] = [];
    const session = new RtcSession('sender', () => peer, (m) => sent.push(m));
    await session.start([]);
    await session.onPeerReady();
    expect(peer.createOffer).toHaveBeenCalled();
    expect(sent).toContainEqual({ type: 'offer', sdp: 'OFFER' });
  });

  it('receiver answers a remote offer', async () => {
    const peer = fakePeer();
    const sent: ClientMsg[] = [];
    const session = new RtcSession('receiver', () => peer, (m) => sent.push(m));
    await session.start([]);
    await session.handleSignal({ type: 'offer', sdp: 'REMOTE' });
    expect(peer.setRemoteDescription).toHaveBeenCalled();
    expect(sent).toContainEqual({ type: 'answer', sdp: 'ANSWER' });
  });

  it('forwards local ICE candidates to signaling', async () => {
    const peer = fakePeer();
    const sent: ClientMsg[] = [];
    const session = new RtcSession('sender', () => peer, (m) => sent.push(m));
    await session.start([]);
    peer.trigger('ice', { candidate: { candidate: 'cand', sdpMid: '0' } });
    expect(sent).toContainEqual({ type: 'ice', candidate: { candidate: 'cand', sdpMid: '0' } });
  });

  it('surfaces a remote track stream to the render callback', async () => {
    const peer = fakePeer();
    const session = new RtcSession('receiver', () => peer, () => {});
    const streams: MediaStream[] = [];
    session.onRemoteStream((s) => streams.push(s));
    await session.start([]);
    const stream = {} as MediaStream;
    peer.trigger('track', { streams: [stream] });
    expect(streams).toEqual([stream]);
  });

  it('reports the detected transport once when the connection completes', async () => {
    const peer = fakePeer();
    peer.stats = new Map([
      ['p1', { id: 'p1', type: 'candidate-pair', state: 'succeeded', remoteCandidateId: 'rc1' }],
      ['rc1', { id: 'rc1', type: 'remote-candidate', candidateType: 'relay' }],
    ]) as unknown as RTCStatsReport;
    const session = new RtcSession('sender', () => peer, () => {});
    const transports: string[] = [];
    session.onConnected((t) => transports.push(t));
    await session.start([]);

    peer.connectionState = 'connected';
    peer.trigger('conn');
    await Promise.resolve();
    await Promise.resolve();

    // fires exactly once, even on a repeated state change
    peer.trigger('conn');
    await Promise.resolve();

    expect(transports).toEqual(['relay']);
  });
});
