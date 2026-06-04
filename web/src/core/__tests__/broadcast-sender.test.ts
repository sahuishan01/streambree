import { describe, it, expect, vi } from 'vitest';
import { BroadcastSender } from '../broadcast-session';
import type { ISocket } from '../signaling-client';
import type { IPeer } from '../rtc-session';

class FakeSocket implements ISocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() {}
  open() { this.onopen?.(); }
  emit(m: string) { this.onmessage?.({ data: m }); }
}

function fakePeer(): IPeer {
  return {
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER' }) as RTCSessionDescriptionInit),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'A' }) as RTCSessionDescriptionInit),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    getSenders: () => [], getReceivers: () => [],
    getStats: async () => new Map() as unknown as RTCStatsReport,
    connectionState: 'new',
    close: vi.fn(), onicecandidate: null, ontrack: null, onconnectionstatechange: null,
  };
}

const fakeStream = { getTracks: () => [] } as unknown as MediaStream;

describe('BroadcastSender', () => {
  it('joins as broadcaster and offers to each viewer who joins', async () => {
    const socket = new FakeSocket();
    const peers: IPeer[] = [];
    const sender = new BroadcastSender('ws://x', 'JWT', 'CODE', 'realtime', fakeStream, [],
      () => socket, () => { const p = fakePeer(); peers.push(p); return p; });
    sender.start();
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'join-broadcast', code: 'CODE', role: 'broadcaster', jwt: 'JWT' });

    socket.emit('{"type":"broadcast-joined","live":true,"viewers":[]}');
    socket.emit('{"type":"viewer-joined","peer_id":"v1"}');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(peers.length).toBe(1);
    expect(socket.sent.some((f) => f.includes('"type":"offer"') && f.includes('"peer_id":"v1"'))).toBe(true);
  });

  it('tracks viewer count and closes a connection when a viewer leaves', async () => {
    const socket = new FakeSocket();
    const sender = new BroadcastSender('ws://x', 'JWT', 'CODE', 'realtime', fakeStream, [],
      () => socket, () => fakePeer());
    const counts: number[] = [];
    sender.onViewerCount((n) => counts.push(n));
    sender.start();
    socket.open();
    socket.emit('{"type":"viewer-joined","peer_id":"v1"}');
    await Promise.resolve(); await Promise.resolve();
    socket.emit('{"type":"viewer-left","peer_id":"v1"}');
    await Promise.resolve();
    expect(counts[counts.length - 1]).toBe(0);
  });

  it('reports being force-stopped', async () => {
    const socket = new FakeSocket();
    const sender = new BroadcastSender('ws://x', 'JWT', 'CODE', 'realtime', fakeStream, [],
      () => socket, () => fakePeer());
    let stopped = false;
    sender.onStopped(() => { stopped = true; });
    sender.start();
    socket.open();
    socket.emit('{"type":"force-stopped","by":"owner"}');
    expect(stopped).toBe(true);
  });
});
