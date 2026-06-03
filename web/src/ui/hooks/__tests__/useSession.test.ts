import { describe, it, expect, vi } from 'vitest';
import { Session } from '../useSession';
import type { ISocket } from '../../../core/signaling-client';
import type { IPeer } from '../../../core/rtc-session';

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
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'ANSWER' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    close: vi.fn(),
    onicecandidate: null,
    ontrack: null,
  };
}

describe('Session orchestration', () => {
  it('moves to negotiating and sends an offer when a peer is already present', async () => {
    const socket = new FakeSocket();
    const session = new Session('ws://x/ws', 'sender', 'realtime', () => socket, () => fakePeer());
    const states: string[] = [];
    session.onState((s) => states.push(s.conn));
    session.start('R1');
    socket.open();
    socket.emit('{"type":"joined","peer_present":true,"ice_servers":[]}');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toContain('negotiating');
    expect(socket.sent.some((f) => f.includes('"type":"offer"'))).toBe(true);
  });
});
