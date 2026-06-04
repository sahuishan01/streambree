import { describe, it, expect, vi } from 'vitest';
import { BroadcastViewer } from '../broadcast-session';
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
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'O' }) as RTCSessionDescriptionInit),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'ANSWER' }) as RTCSessionDescriptionInit),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    getSenders: () => [], getReceivers: () => [],
    getStats: async () => new Map() as unknown as RTCStatsReport,
    connectionState: 'new',
    close: vi.fn(), onicecandidate: null, ontrack: null, onconnectionstatechange: null,
  };
}

describe('BroadcastViewer', () => {
  it('joins as viewer and answers the broadcaster offer', async () => {
    const socket = new FakeSocket();
    const viewer = new BroadcastViewer('ws://x', 'JWT', 'CODE', [], () => socket, () => fakePeer());
    viewer.start();
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'join-broadcast', code: 'CODE', role: 'viewer', jwt: 'JWT' });

    socket.emit('{"type":"broadcast-joined","live":true,"viewers":[]}');
    socket.emit('{"type":"offer","peer_id":"ignored","sdp":"REMOTE"}');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(socket.sent.some((f) => f.includes('"type":"answer"') && f.includes('ANSWER'))).toBe(true);
  });

  it('reports the stream ending', async () => {
    const socket = new FakeSocket();
    const viewer = new BroadcastViewer('ws://x', 'JWT', 'CODE', [], () => socket, () => fakePeer());
    let ended = false;
    viewer.onEnded(() => { ended = true; });
    viewer.start();
    socket.open();
    socket.emit('{"type":"broadcaster-left"}');
    expect(ended).toBe(true);
  });
});
